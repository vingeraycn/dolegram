import { telegramClient } from '../telegram.mjs';
import { SitesStore } from './d1-store.mjs';
import { SignedCallbacks, secretEqual } from './callbacks.mjs';
import { SitesBridge, SitesProtocolError } from './bridge.mjs';

const json = (status, value) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

async function boundedJson(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing request body');
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 262144) { await reader.cancel(); throw new Error('Request too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

export function createSitesWorker({ callbackOrigins = [], callbackPost = null, telegramFactory = telegramClient, now = Date.now } = {}) {
  const callbacks = new SignedCallbacks({ origins: callbackOrigins, post: callbackPost, now });
  return {
    async fetch(request, env) {
      const path = new URL(request.url).pathname;
      if (request.method !== 'POST' || !['/mcp', '/telegram/webhook'].includes(path)) return json(404, { error: 'Not found' });
      if (typeof env.OWNER_USER_ID !== 'string' || !env.OWNER_USER_ID || !env.DB) return json(503, { error: 'Owner and D1 must be configured' });
      if (path === '/mcp' && !secretEqual(request.headers.get('oai-authenticated-user-id'), env.OWNER_USER_ID)) return json(401, { error: 'Unauthorized' });
      if (path === '/telegram/webhook' && (typeof env.TELEGRAM_WEBHOOK_SECRET !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(env.TELEGRAM_WEBHOOK_SECRET) || !secretEqual(request.headers.get('X-Telegram-Bot-Api-Secret-Token'), env.TELEGRAM_WEBHOOK_SECRET))) return json(401, { error: 'Unauthorized' });
      if (path === '/telegram/webhook' && !callbacks.ready) return json(503, { error: 'Event callback transport not verified' });
      let allowed;
      try {
        allowed = JSON.parse(env.ALLOWED_CHAT_IDS_JSON);
        if (!Array.isArray(allowed) || !allowed.length || !allowed.every(id => typeof id === 'string' && /^[1-9][0-9]*$/.test(id))) throw new Error('Invalid allowlist');
      } catch { return json(503, { error: 'Explicit private chat allowlist required' }); }
      let value;
      try { value = await boundedJson(request); } catch { return json(400, { error: 'Invalid or oversized JSON body' }); }
      const store = new SitesStore(env.DB, env.OWNER_USER_ID);
      const telegram = typeof env.TELEGRAM_BOT_TOKEN === 'string' && env.TELEGRAM_BOT_TOKEN
        ? telegramFactory(env.TELEGRAM_BOT_TOKEN)
        : async () => { throw new Error('Telegram credential not configured'); };
      const bridge = new SitesBridge({ store, allowedChatIds: allowed, telegram, callbacks, now });
      try {
        if (path === '/mcp') return json(200, { jsonrpc: '2.0', id: value?.id ?? null, result: await bridge.rpc(value) });
        const result = await bridge.receive(value);
        // Initial delivery is awaited. Durable recovery belongs to the explicit flush tool.
        if (callbacks.ready) await bridge.flush();
        return json(200, result);
      } catch (error) {
        const failure = error instanceof SitesProtocolError ? error : new SitesProtocolError(-32603, 'Operation failed');
        if (path === '/telegram/webhook') return json(failure.code === -32602 ? 400 : 500, { error: 'Webhook processing failed' });
        return json(200, { jsonrpc: '2.0', id: value?.id ?? null, error: { code: failure.code, message: failure.message, ...(failure.reason ? { data: { reason: failure.reason } } : {}) } });
      }
    },
  };
}

// No official callback-origin/egress contract has been verified for production yet.
// Production subscriptions fail closed; tests explicitly inject a synthetic transport.
export default createSitesWorker();

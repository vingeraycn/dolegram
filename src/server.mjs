import { createServer } from 'node:http';
import { readFileSync, statSync, openSync, closeSync, unlinkSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { Bridge, RpcFailure } from './bridge.mjs';
import { TelegramPoller } from './polling.mjs';
import { Store } from './store.mjs';
import { telegramClient } from './telegram.mjs';

export function loadConfig(path) {
  if ((statSync(path).mode & 0o077) !== 0) throw new Error('Configuration must have mode 0600');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  for (const field of ['ownerId', 'mcpBearerToken', 'telegramBotToken']) {
    if (typeof config[field] !== 'string' || !config[field].trim()) throw new Error(`Missing configuration field: ${field}`);
  }
  config.telegramMode ??= 'webhook';
  if (!['webhook', 'polling'].includes(config.telegramMode)) throw new Error('Invalid Telegram mode');
  if (config.telegramMode === 'polling' && (typeof config.expectedBotId !== 'string' || !/^[1-9][0-9]*$/.test(config.expectedBotId) || typeof config.expectedBotUsername !== 'string' || !/^[A-Za-z0-9_]{5,32}$/.test(config.expectedBotUsername))) throw new Error('Polling requires expected Bot identity');
  if (config.mcpBearerToken.length < 32 || (config.telegramMode === 'webhook' && (typeof config.telegramWebhookSecret !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(config.telegramWebhookSecret)))) throw new Error('Invalid authentication configuration');
  if (!Array.isArray(config.allowedChatIds) || !config.allowedChatIds.length || !config.allowedChatIds.every(id => typeof id === 'string' && /^[1-9][0-9]*$/.test(id))) throw new Error('Explicit private chat allowlist required');
  return config;
}

export function createBridgeServer(bridge) {
  let tail = Promise.resolve();
  const serialize = action => {
    const next = tail.then(action);
    tail = next.catch(() => {});
    return next;
  };
  const server = createServer(async (request, response) => {
    const respond = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(value));
    };
    if (request.url === '/telegram/webhook' && bridge.config.telegramMode === 'polling') return respond(404, { error: 'Not found' });
    if (request.method !== 'POST' || !['/mcp', '/telegram/webhook'].includes(request.url)) return respond(404, { error: 'Not found' });
    let parsed;
    try {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 262144) return respond(413, { error: 'Request too large' });
        chunks.push(chunk);
      }
      parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { return respond(400, { error: 'Invalid JSON' }); }
    try {
      const result = await serialize(() => request.url === '/mcp'
        ? bridge.rpc(parsed, request.headers)
        : bridge.receive(parsed, request.headers['x-telegram-bot-api-secret-token']));
      respond(200, request.url === '/mcp' ? { jsonrpc: '2.0', id: parsed.id, result } : result);
    } catch (error) {
      const failure = error instanceof RpcFailure ? error : new RpcFailure(-32603, 'Internal error');
      let status = failure.code === -32001 ? 401 : 200;
      if (request.url === '/telegram/webhook' && status !== 401) {
        status = failure.code === -32602 ? 400 : 500;
      }
      respond(status, request.url === '/mcp' ? { jsonrpc: '2.0', id: parsed?.id ?? null, error: { code: failure.code, message: failure.message, ...(failure.reason ? { data: { reason: failure.reason } } : {}) } } : { error: 'Request rejected' });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  const timer = setInterval(() => { serialize(() => bridge.deliver()).catch(() => {}); }, 1000);
  timer.unref();
  server.on('close', () => clearInterval(timer));
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try {
    const config = loadConfig(process.env.DOTG_CONFIG ?? 'config.local.json');
    if (process.env.DOTG_ENABLE_POLLING === '1' && config.telegramMode !== 'polling') throw new Error('Polling mode required');
    const database = resolve(process.env.DOTG_DATABASE ?? 'runtime/dotg.sqlite');
    mkdirSync(dirname(database), { recursive: true, mode: 0o700 });
    // Refuse a second process; a stale lock requires explicit operator inspection.
    const lock = `${database}.lock`;
    const fd = openSync(lock, 'wx', 0o600);
    const store = new Store(database);
    const bridge = new Bridge({ store, config, telegram: telegramClient(config.telegramBotToken) });
    const server = createBridgeServer(bridge);
    const controller = new AbortController();
    let polling = Promise.resolve();
    server.listen(8787, '127.0.0.1', () => {
      console.log('dotg listening on loopback port 8787');
      if (process.env.DOTG_ENABLE_POLLING === '1') {
        const poller = new TelegramPoller({ bridge, store, telegram: telegramClient(config.telegramBotToken), botId: config.expectedBotId, username: config.expectedBotUsername });
        polling = poller.run(controller.signal).catch(() => { console.error('dotg polling stopped; operator inspection required'); });
      }
    });
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      controller.abort();
      server.close(() => { polling.finally(() => { store.close(); closeSync(fd); unlinkSync(lock); }); });
    };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
  } catch { console.error('dotg startup failed; check private configuration and runtime lock'); process.exitCode = 1; }
}

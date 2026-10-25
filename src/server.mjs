import { createServer } from 'node:http';
import { readFileSync, fstatSync, constants, openSync, closeSync, unlinkSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { Bridge, RpcFailure } from './bridge.mjs';
import { TelegramPoller } from './polling.mjs';
import { Store } from './store.mjs';
import { telegramClient } from './telegram.mjs';
import { TelegramActivity } from './activity.mjs';
import { DeliveryWorker } from './delivery.mjs';
import { callbackPost, callbackResolver } from './security.mjs';

export function loadConfig(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let config;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.uid !== process.getuid() || stat.size > 65536) throw new Error('Configuration must be a private regular file owned by this user');
    config = JSON.parse(readFileSync(fd, 'utf8'));
  } finally { closeSync(fd); }
  for (const field of ['ownerId', 'mcpBearerToken', 'telegramBotToken']) {
    if (typeof config[field] !== 'string' || !config[field].trim()) throw new Error(`Missing configuration field: ${field}`);
  }
  config.telegramMode ??= 'webhook';
  if (!['webhook', 'polling'].includes(config.telegramMode)) throw new Error('Invalid Telegram mode');
  if (config.telegramMode === 'polling' && (typeof config.expectedBotId !== 'string' || !/^[1-9][0-9]*$/.test(config.expectedBotId) || typeof config.expectedBotUsername !== 'string' || !/^[A-Za-z0-9_]{5,32}$/.test(config.expectedBotUsername))) throw new Error('Polling requires expected Bot identity');
  if (!/^[!-~]{32,4096}$/.test(config.mcpBearerToken) || (config.telegramMode === 'webhook' && (typeof config.telegramWebhookSecret !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(config.telegramWebhookSecret)))) throw new Error('Invalid authentication configuration');
  if (!Array.isArray(config.allowedChatIds) || !config.allowedChatIds.length || !config.allowedChatIds.every(id => typeof id === 'string' && /^[1-9][0-9]*$/.test(id))) throw new Error('Explicit private chat allowlist required');
  return config;
}

const lifecycles = new WeakMap();

export async function closeBridgeServer(server) {
  const lifecycle = lifecycles.get(server);
  await Promise.all([lifecycle?.stop(), new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve(undefined));
  })]);
  // A request can finish reading its body after shutdown starts. Even if its
  // client disconnects, wait for the latest queued operation before closing DB.
  await lifecycle?.idle();
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
  const delivery = new DeliveryWorker(bridge);
  bridge.onAccepted = () => { void delivery.kick(); };
  const activityTimer = setInterval(() => bridge.activity?.poke(), 1000);
  activityTimer.unref();
  const drain = async () => {
    clearInterval(activityTimer);
    bridge.onAccepted = () => {};
    await Promise.all([delivery.close(), bridge.activity?.close()]);
  };
  lifecycles.set(server, { stop: drain, idle: () => tail });
  server.on('close', () => { void drain(); });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try {
    const config = loadConfig(process.env.DOTG_CONFIG ?? 'config.local.json');
    const resolveCallback = callbackResolver(process.env.DOTG_CALLBACK_DNS_SERVERS);
    if (process.env.DOTG_ENABLE_POLLING === '1' && config.telegramMode !== 'polling') throw new Error('Polling mode required');
    const database = resolve(process.env.DOTG_DATABASE ?? 'runtime/dotg.sqlite');
    mkdirSync(dirname(database), { recursive: true, mode: 0o700 });
    // Refuse a second process; a stale lock requires explicit operator inspection.
    const lock = `${database}.lock`;
    const fd = openSync(lock, 'wx', 0o600);
    const store = new Store(database);
    const telegram = telegramClient(config.telegramBotToken);
    const activity = new TelegramActivity({ store, config, telegram });
    const bridge = new Bridge({ store, config, telegram, activity,
      post: (url, body, headers) => callbackPost(url, body, headers, resolveCallback) });
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
      Promise.all([polling, closeBridgeServer(server)]).then(() => {
        store.close(); closeSync(fd); unlinkSync(lock);
      }).catch(() => { console.error('dotg shutdown incomplete; runtime lock retained'); process.exitCode = 1; });
    };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
  } catch { console.error('dotg startup failed; check private configuration and runtime lock'); process.exitCode = 1; }
}

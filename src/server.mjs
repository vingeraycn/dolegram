import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RpcFailure } from './bridge.mjs';
import { DeliveryWorker } from './delivery.mjs';
import { runStandalone } from './runtime.mjs';

export { loadConfig } from './config.mjs';

const lifecycles = new WeakMap();

export async function closeBridgeServer(server) {
  const lifecycle = lifecycles.get(server);
  await Promise.all([lifecycle?.stop(), new Promise((resolve, reject) => {
    server.close(error => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve(undefined));
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void runStandalone({ createBridgeServer, closeBridgeServer });
}

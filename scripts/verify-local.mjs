import assert from 'node:assert/strict';
import { Bridge } from '../src/bridge.mjs';
import { Store } from '../src/store.mjs';
import { createBridgeServer, closeBridgeServer } from '../src/server.mjs';

// Synthetic values only. This temporary service must never be tunneled publicly.
const config = {
  ownerId: 'local-synthetic-owner', allowedChatIds: ['123'],
  mcpBearerToken: 'synthetic-loopback-test-value', telegramWebhookSecret: 'synthetic-webhook-test-value',
};
const store = new Store(':memory:');
const bridge = new Bridge({
  store, config,
  telegram: async () => { throw new Error('Real Telegram transport is disabled'); },
  post: async () => { throw new Error('Real callback transport is disabled'); },
});
const server = createBridgeServer(bridge);
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Unexpected loopback listener address');
  assert.equal(address.address, '127.0.0.1');
  const origin = `http://127.0.0.1:${address.port}`;
  for (const path of ['/', '/files', '/api', '/mcp/extra', '/telegram/webhook/extra']) {
    assert.equal((await fetch(origin + path, { method: 'POST', body: '{}' })).status, 404);
  }
  assert.equal((await fetch(origin + '/mcp')).status, 404);
  assert.equal((await fetch(origin + '/mcp', { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await fetch(origin + '/telegram/webhook', { method: 'POST', body: '{}' })).status, 401);
  const response = await fetch(origin + '/mcp', { method: 'POST', headers: { authorization: `Bearer ${config.mcpBearerToken}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_bridge_status', arguments: {} } }) });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(result.result.content[0].text).messages, 0);
  console.log('PASS: isolated loopback port; two POST routes authenticated; unrelated paths rejected; no external transports or credentials used.');
} finally {
  if (server.listening) await closeBridgeServer(server);
  else server.emit('close');
  store.close();
}

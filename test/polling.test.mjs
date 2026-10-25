import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Bridge } from '../src/bridge.mjs';
import { Store } from '../src/store.mjs';
import { TelegramPoller, PollingStopped } from '../src/polling.mjs';
import { TelegramFailure, telegramClient } from '../src/telegram.mjs';
import { loadConfig, createBridgeServer, closeBridgeServer } from '../src/server.mjs';
import { EVENT_NAME } from '../src/contracts.mjs';
import { Webhook } from 'standardwebhooks';

const config = { ownerId: 'mock-owner', allowedChatIds: ['123'], mcpBearerToken: 'x'.repeat(32), telegramMode: 'polling', expectedBotId: '456', expectedBotUsername: 'mock_test_bot', telegramBotToken: 'synthetic' };
const update = id => ({ update_id: id, message: { message_id: id, chat: { id: 123, type: 'private' }, from: { id: 123, is_bot: false }, text: 'Synthetic polling fixture', date: Math.floor(Date.now() / 1000) } });
function setup(store = new Store(':memory:'), batch = [update(10)]) {
  const calls = [];
  const telegram = async (method, args) => {
    calls.push({ method, args });
    if (method === 'getMe') return { id: 456, username: config.expectedBotUsername, is_bot: true };
    if (method === 'getWebhookInfo') return { url: '' };
    if (method === 'getUpdates') return batch;
    throw new Error('Unexpected external write');
  };
  const bridge = new Bridge({ store, config, telegram, post: async () => { throw new Error('Unexpected callback'); } });
  const poller = new TelegramPoller({ bridge, store, telegram, botId: config.expectedBotId, username: config.expectedBotUsername });
  return { bridge, poller, calls, store };
}

test('polling persists acceptance before offset and resumes after SQLite reopen', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dotg-polling-'));
  try {
    const first = setup(new Store(join(dir, 'test.sqlite')));
    await first.poller.once();
    assert.equal(first.calls[2].args.offset, 0);
    assert.deepEqual(first.calls[2].args.allowed_updates, ['message']);
    assert.equal(first.store.read().messages.telegram_10.text, 'Synthetic polling fixture');
    first.store.close();
    const second = setup(new Store(join(dir, 'test.sqlite')), [update(11)]);
    await second.poller.once();
    assert.equal(second.calls[2].args.offset, 11);
    assert.equal(second.store.read().polling['mock-owner:456'], 12);
    second.store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('polling queues a signed official event and tools reply once to its message', async () => {
  const item = setup(); const deliveries = []; const replies = [];
  const secret = `whsec_${Buffer.alloc(32, 9).toString('base64')}`;
  item.bridge.post = async (_url, body, headers) => {
    const value = new Webhook(secret).verify(body, headers);
    if (value.type === 'verification') return { status: 200, body: JSON.stringify({ challenge: value.challenge }) };
    deliveries.push(value);
    return { status: 204, body: '' };
  };
  item.bridge.telegram = async (method, args) => { replies.push({ method, args }); return { message_id: 900 }; };
  try {
    const headers = { authorization: `Bearer ${config.mcpBearerToken}` };
    const rpc = (method, params) => item.bridge.rpc({ jsonrpc: '2.0', id: 1, method, params }, headers);
    await rpc('events/subscribe', { name: EVENT_NAME, arguments: { chat_id: '123' }, delivery: { mode: 'webhook', url: 'https://callback.example.invalid/events', secret } });
    await item.poller.once();
    await item.bridge.deliver();
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].name, EVENT_NAME);
    const args = { message_key: deliveries[0].data.message_key, text: 'Useful synthetic answer', revision: 1, final: true };
    await rpc('tools/call', { name: 'reply_telegram_message', arguments: args });
    await rpc('tools/call', { name: 'reply_telegram_message', arguments: args });
    assert.equal(replies.length, 1);
    assert.equal(replies[0].method, 'sendMessage');
    assert.equal(String(replies[0].args.chat_id), '123');
  } finally { item.store.close(); }
});

test('replay after acceptance and before cursor commit is deduplicated', async () => {
  const item = setup();
  try {
    item.bridge.acceptTelegramUpdate(update(10));
    await item.poller.once();
    assert.equal(Object.keys(item.store.read().messages).length, 1);
    assert.equal(item.store.read().polling['mock-owner:456'], 11);
  } finally { item.store.close(); }
});

test('identity mismatch or existing webhook prevents polling and never changes webhook', async () => {
  for (const identityMismatch of [true, false]) {
    const item = setup(); const calls = [];
    item.poller.telegram = async method => {
      calls.push(method);
      return method === 'getMe' ? { id: identityMismatch ? 999 : 456, username: config.expectedBotUsername, is_bot: true } : { url: 'https://example.invalid/existing' };
    };
    try { await assert.rejects(item.poller.once(), PollingStopped); assert.ok(!calls.includes('getUpdates')); }
    finally { item.store.close(); }
  }
});

test('failed acceptance does not advance cursor; private allowlist still applies', async () => {
  const item = setup();
  try {
    item.bridge.acceptTelegramUpdate = () => { throw new Error('Synthetic storage failure'); };
    await assert.rejects(item.poller.once());
    assert.equal(item.store.read().polling, undefined);
    const denied = setup(item.store, [{ ...update(10), message: { ...update(10).message, chat: { id: 999, type: 'private' } } }]);
    await denied.poller.once();
    assert.deepEqual(item.store.read().messages, {});
  } finally { item.store.close(); }
});

test('concurrent poll and invalid batch are refused without cursor changes', async () => {
  const item = setup(undefined, [{ update_id: -1 }]);
  try {
    item.poller.busy = true;
    await assert.rejects(item.poller.once(), PollingStopped);
    item.poller.busy = false;
    await assert.rejects(item.poller.once(), PollingStopped);
    assert.equal(item.store.read().polling, undefined);
  } finally { item.store.close(); }
});

test('Telegram conflict stops polling without retry or raw error disclosure', async () => {
  const client = telegramClient('synthetic', async () => ({ ok: false, status: 409, json: async () => ({ ok: false, error_code: 409, description: 'sensitive server detail' }) }));
  await assert.rejects(client('getUpdates', {}), error => error instanceof TelegramFailure && error.code === 'conflict' && !error.message.includes('sensitive'));
  const item = setup();
  try {
    item.poller.telegram = async () => { throw new TelegramFailure('conflict'); };
    await assert.rejects(item.poller.run(new AbortController().signal), PollingStopped);
  } finally { item.store.close(); }
});

test('shutdown aborts retry backoff without another request', async () => {
  const item = setup(); const controller = new AbortController(); let calls = 0;
  item.poller.telegram = async () => {
    calls += 1;
    setTimeout(() => controller.abort(), 0);
    throw new TelegramFailure('rate_limit', 60);
  };
  try {
    await item.poller.run(controller.signal);
    await item.poller.once(controller.signal);
    assert.equal(calls, 1);
  } finally { item.store.close(); }
});

test('polling config needs identity but no webhook secret; webhook route disabled', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dotg-config-'));
  const item = setup(); const server = createBridgeServer(item.bridge);
  try {
    const file = join(dir, 'config.json');
    writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
    assert.equal(loadConfig(file).telegramMode, 'polling');
    writeFileSync(file, JSON.stringify({ ...config, expectedBotId: '' }));
    assert.throws(() => loadConfig(file));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.equal((await fetch(`http://127.0.0.1:${address.port}/telegram/webhook`, { method: 'POST', body: '{}' })).status, 404);
    assert.throws(() => item.bridge.receive(update(10), undefined));
  } finally { await closeBridgeServer(server); item.store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('private configuration rejects symlinks, broad permissions and header injection', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dotg-private-config-'));
  try {
    const file = join(dir, 'config.json');
    const link = join(dir, 'config-link.json');
    writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
    symlinkSync(file, link);
    assert.throws(() => loadConfig(link));
    chmodSync(file, 0o644);
    assert.throws(() => loadConfig(file));
    chmodSync(file, 0o600);
    writeFileSync(file, JSON.stringify({ ...config, mcpBearerToken: 'x'.repeat(32) + '\r\n' }));
    assert.throws(() => loadConfig(file));
    writeFileSync(file, ' '.repeat(65537));
    assert.throws(() => loadConfig(file));
    writeFileSync(file, JSON.stringify(config));
    assert.equal(loadConfig(file).ownerId, config.ownerId);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

import test from 'node:test';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Webhook } from 'standardwebhooks';
import { Bridge } from '../src/bridge.mjs';
import { Store } from '../src/store.mjs';
import { EVENT_NAME } from '../src/contracts.mjs';
import { publicAddress, callbackPost } from '../src/security.mjs';
import { telegramClient, TelegramFailure } from '../src/telegram.mjs';
import { createBridgeServer } from '../src/server.mjs';

const config = { ownerId: 'test-owner', allowedChatIds: ['123'], mcpBearerToken: 'test-mcp-secret', telegramWebhookSecret: 'test-webhook-secret' };
const headers = { authorization: `Bearer ${config.mcpBearerToken}` };
const signingSecret = `whsec_${Buffer.alloc(32, 7).toString('base64')}`;
const replacementSecret = `whsec_${Buffer.alloc(32, 8).toString('base64')}`;
const subscription = (changes = {}) => ({ name: EVENT_NAME, arguments: { chat_id: '123' }, delivery: { mode: 'webhook', url: 'https://callback.example.test/events', secret: signingSecret }, ...changes });
const update = (id = 1) => ({ update_id: id, message: { message_id: id, date: Math.floor(Date.now() / 1000), chat: { id: 123, type: 'private' }, from: { id: 123, is_bot: false }, text: 'A synthetic test question.' } });
const fixture = (t, options = {}) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const calls = [];
  const posts = [];
  const bridge = new Bridge({ store, config, telegram: async (method, params) => { calls.push({ method, params }); return { message_id: 77 }; },
    post: async (url, body, signedHeaders) => {
      const value = JSON.parse(body);
      posts.push({ url, value, body, headers: signedHeaders });
      return { status: 200, body: JSON.stringify({ challenge: value.challenge }) };
    }, ...options });
  const rpc = (method, params) => bridge.rpc({ jsonrpc: '2.0', id: 1, method, params }, headers);
  return { bridge, store, calls, posts, rpc };
};

test('official discovery and authenticated schemas', async t => {
  const { bridge, rpc } = fixture(t);
  await assert.rejects(bridge.rpc({ method: 'events/list' }, {}), /Unauthorized/);
  assert.deepEqual((await rpc('server/discover')).supportedVersions, ['2026-07-28']);
  assert.equal((await rpc('events/list')).events[0].name, EVENT_NAME);
  assert.equal((await rpc('tools/list')).tools.length, 4);
  await assert.rejects(rpc('tools/call', { name: 'read_telegram_message', arguments: { message_key: 'x', extra: true } }), /Invalid/);
});

test('signed callback verification, idempotent refresh and key rotation', async t => {
  const { rpc, posts, store } = fixture(t);
  const first = await rpc('events/subscribe', subscription());
  const again = await rpc('events/subscribe', subscription({ ttlMs: 10000 }));
  assert.equal(first.id, again.id);
  assert.equal(Object.keys(store.read().subscriptions).length, 1);
  assert.equal(posts.length, 1, 'recent verification is cached for identical refreshes');
  const verification = posts[0];
  assert.equal(new Webhook(signingSecret).verify(verification.body, verification.headers).type, 'verification');
  const rotated = subscription(); rotated.delivery.secret = replacementSecret;
  await rpc('events/subscribe', rotated);
  const last = posts.at(-1);
  assert.equal(new Webhook(signingSecret).verify(last.body, last.headers).type, 'verification');
  assert.equal(new Webhook(replacementSecret).verify(last.body, last.headers).type, 'verification');
  assert.equal(store.read().subscriptions[first.id].secret, replacementSecret);
});

test('callback verification failure never activates a subscription', async t => {
  const { rpc, store } = fixture(t, { post: async () => ({ status: 200, body: '{"challenge":"wrong"}' }) });
  await assert.rejects(rpc('events/subscribe', subscription()), error => error.code === -32015);
  assert.equal(Object.keys(store.read().subscriptions).length, 0);
  await assert.rejects(rpc('events/subscribe', subscription({ arguments: { chat_id: '999' } })), /Invalid/);
});

test('private allowlist, replay age and duplicate update enforcement', async t => {
  const { bridge, rpc, posts, store } = fixture(t);
  await rpc('events/subscribe', subscription());
  assert.throws(() => bridge.receive(update(), 'wrong'), /Unauthorized/);
  const group = update(); group.message.chat.type = 'group';
  assert.deepEqual(bridge.receive(group, config.telegramWebhookSecret), { ignored: true });
  const stranger = update(); stranger.message.chat.id = 999;
  assert.deepEqual(bridge.receive(stranger, config.telegramWebhookSecret), { ignored: true });
  const stale = update(); stale.message.date -= 90000;
  assert.deepEqual(bridge.receive(stale, config.telegramWebhookSecret), { ignored: true });
  bridge.receive(update(), config.telegramWebhookSecret);
  assert.deepEqual(bridge.receive(update(), config.telegramWebhookSecret), { duplicate: true });
  await bridge.deliver();
  assert.equal(posts.length, 2);
  assert.equal(posts[1].value.name, EVENT_NAME);
  assert.equal(posts[1].headers['webhook-id'], posts[1].value.eventId);
  assert.equal(new Webhook(signingSecret).verify(posts[1].body, posts[1].headers).data.message_key, 'telegram_1');
  assert.equal(Object.keys(store.read().messages).length, 1);
});

test('bounded retries preserve event ID and change signing timestamp', async t => {
  let now = Date.now();
  const sent = [];
  const { bridge, rpc, store } = fixture(t, { now: () => now, post: async (_url, body, signedHeaders) => {
    const parsed = JSON.parse(body);
    if (parsed.type === 'verification') return { status: 200, body: JSON.stringify({ challenge: parsed.challenge }) };
    sent.push(signedHeaders);
    return { status: 503, body: '' };
  } });
  await rpc('events/subscribe', subscription());
  bridge.receive(update(), config.telegramWebhookSecret);
  for (let i = 0; i < 8; i++) { await bridge.deliver(); now += 60001; }
  assert.equal(sent.length, 6);
  assert.equal(sent[0]['webhook-id'], sent[1]['webhook-id']);
  assert.notEqual(sent[0]['webhook-timestamp'], sent[1]['webhook-timestamp']);
  assert.equal(Object.values(store.read().deliveries)[0].done, true);
});

test('unsubscribe, expiry and terminal callback statuses stop delivery', async t => {
  for (const status of [410, 413]) {
    const { bridge, rpc, store } = fixture(t, { post: async (_url, body) => { const value = JSON.parse(body); return { status: value.type ? 200 : status, body: JSON.stringify({ challenge: value.challenge }) }; } });
    await rpc('events/subscribe', subscription());
    bridge.receive(update(), config.telegramWebhookSecret);
    await bridge.deliver(); await bridge.deliver();
    assert.equal(Object.values(store.read().deliveries)[0].attempts, 1);
    await rpc('events/unsubscribe', subscription());
    await rpc('events/unsubscribe', subscription());
    assert.equal(Object.keys(store.read().subscriptions).length, 0);
  }
  let now = Date.now();
  const { bridge, rpc, posts } = fixture(t, { now: () => now });
  await rpc('events/subscribe', subscription({ ttlMs: 1 }));
  now += 2;
  bridge.receive(update(), config.telegramWebhookSecret);
  await bridge.deliver();
  assert.equal(posts.length, 1);
});

test('short reply is sent once, retries are idempotent and final is closed', async t => {
  const { bridge, calls } = fixture(t);
  bridge.receive(update(), config.telegramWebhookSecret);
  const args = { message_key: 'telegram_1', text: 'A useful complete answer.', revision: 1, final: true };
  await bridge.callTool('reply_telegram_message', args);
  await bridge.callTool('reply_telegram_message', args);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'sendMessage');
  await assert.rejects(bridge.callTool('update_telegram_message', { ...args, text: args.text + ' More.', revision: 2 }), /Invalid/);
});

test('long replies use one formal message and 2-3 cumulative edits', async t => {
  const { bridge, calls } = fixture(t);
  bridge.receive(update(), config.telegramWebhookSecret);
  const args = { message_key: 'telegram_1', text: 'Useful first part.', revision: 1, final: false };
  await bridge.callTool('reply_telegram_message', args);
  await assert.rejects(bridge.callTool('update_telegram_message', { ...args, text: 'Replacement', revision: 2 }), /Invalid/);
  await assert.rejects(bridge.callTool('update_telegram_message', { ...args, text: args.text + ' End.', revision: 2, final: true }), /Invalid/);
  for (let revision = 2; revision <= 4; revision++) {
    args.revision = revision; args.text += ' Additional useful detail.'; args.final = revision === 4;
    await bridge.callTool('update_telegram_message', args);
  }
  assert.deepEqual(calls.map(call => call.method), ['sendMessage', 'editMessageText', 'editMessageText', 'editMessageText']);
  assert(calls.slice(1).every(call => call.params.message_id === 77));
  await assert.rejects(bridge.callTool('update_telegram_message', { ...args, revision: 2 }), /Invalid/);
});

test('uncertain Telegram outcomes block duplicate sends and redact errors', async t => {
  let count = 0;
  const { bridge, rpc } = fixture(t, { telegram: async () => { count++; throw new Error('DO_NOT_LEAK_SYNTHETIC_SECRET'); } });
  bridge.receive(update(), config.telegramWebhookSecret);
  const params = { name: 'reply_telegram_message', arguments: { message_key: 'telegram_1', text: 'Useful answer.', revision: 1, final: true } };
  const first = await rpc('tools/call', params);
  const second = await rpc('tools/call', params);
  assert.equal(first.isError, true); assert.equal(second.isError, true);
  assert(!JSON.stringify(first).includes('DO_NOT_LEAK'));
  assert.equal(count, 1);
});

test('durable message and subscription state survives restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dotg-test-'));
  const path = join(directory, 'state.sqlite');
  const first = new Store(path);
  first.mutate(state => { state.messages.synthetic = { reply: { status: 'pending' } }; state.subscriptions.synthetic = { owner: 'test' }; });
  first.close();
  const reopened = new Store(path);
  assert.equal(reopened.read().messages.synthetic.reply.status, 'uncertain');
  assert.equal(reopened.read().subscriptions.synthetic.owner, 'test');
  reopened.close(); rmSync(directory, { recursive: true });
});

test('SSRF checks reject local, mapped, mixed and redirect destinations', async () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fc00::1', '192.0.2.1']) assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress('8.8.8.8'), true);
  const resolver = async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }];
  await assert.rejects(callbackPost('https://example.test', '{}', {}, resolver), /Unsafe/);
  const credentialUrl = new URL('https://example.test');
  credentialUrl.username = 'synthetic-user';
  for (const url of ['http://example.test', credentialUrl.href, 'https://example.test:444', 'https://example.test/#fragment']) await assert.rejects(callbackPost(url, '{}', {}, resolver), /Unsafe/);
});

test('Telegram errors never expose URL tokens or raw response descriptions', async () => {
  const client = telegramClient('synthetic-secret', async () => { throw new Error('https://secret.example.test'); });
  await assert.rejects(client('sendMessage', {}), error => error.code === 'uncertain' && !error.message.includes('secret'));
  const rateLimited = telegramClient('synthetic-secret', async () => ({ ok: false, status: 429, json: async () => ({ error_code: 429, parameters: { retry_after: 4 } }) }));
  await assert.rejects(rateLimited('sendMessage', {}), error => error instanceof TelegramFailure && error.retryAfter === 4);
});

test('HTTP authentication rejects spoofed Sites identity headers', async t => {
  const { bridge } = fixture(t);
  const server = createBridgeServer(bridge);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  const body = JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'server/discover' });
  const denied = await fetch(url, { method: 'POST', headers: { 'oai-authenticated-user-id': 'test-owner' }, body });
  assert.equal(denied.status, 401);
  const accepted = await fetch(url, { method: 'POST', headers, body });
  assert.equal((await accepted.json()).result.capabilities.events.constructor, Object);
});

 test('rate limiting leaves the initial reply retryable only after the deadline', async t => {
  let now = Date.now();
  let attempts = 0;
  const { bridge } = fixture(t, { now: () => now, telegram: async () => {
    attempts++;
    if (attempts === 1) throw new TelegramFailure('rate_limit', 5);
    return { message_id: 77 };
  } });
  bridge.receive(update(), config.telegramWebhookSecret);
  const args = { message_key: 'telegram_1', text: 'Useful answer.', revision: 1, final: true };
  await assert.rejects(bridge.callTool('reply_telegram_message', args), /rejected/);
  await assert.rejects(bridge.callTool('reply_telegram_message', args), /Rate limited/);
  assert.equal(attempts, 1);
  now += 5001;
  await bridge.callTool('reply_telegram_message', args);
  assert.equal(attempts, 2);
});


test('callback transport pins DNS results and returns redirects without following them', async t => {
  let requests = 0;
  t.mock.method(https, 'request', (url, options, onResponse) => {
    requests++;
    assert.equal(url.hostname, 'callback.example.test');
    options.lookup(url.hostname, { all: false }, (error, address, family) => {
      assert.equal(error, null); assert.equal(address, '8.8.8.8'); assert.equal(family, 4);
    });
    options.lookup(url.hostname, { all: true }, (error, addresses) => {
      assert.equal(error, null); assert.deepEqual(addresses, [{ address: '8.8.8.8', family: 4 }]);
    });
    const request = new EventEmitter();
    request.setTimeout = () => request;
    request.end = () => {
      const response = new EventEmitter();
      response.statusCode = 302;
      response.setEncoding = () => {};
      onResponse(response);
      response.emit('end');
    };
    return request;
  });
  const response = await callbackPost('https://callback.example.test/events', '{}', {}, async () => [{ address: '8.8.8.8', family: 4 }]);
  assert.equal(response.status, 302);
  assert.equal(requests, 1);
});

test('plugin preparation generates credential-free official bearer configuration', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dotg-package-test-'));
  try {
    const output = join(directory, 'dotg');
    execFileSync('python3', ['scripts/prepare-plugin.py', '--endpoint', 'https://synthetic.example.test/mcp', '--output', output]);
    const manifest = JSON.parse(readFileSync(join(output, 'plugin.json'), 'utf8'));
    const mcp = JSON.parse(readFileSync(join(output, 'mcp.json'), 'utf8'));
    assert.equal(manifest.name, 'dotg');
    assert.deepEqual(mcp.mcpServers.dotg.extensions['com.openai'].auth, { type: 'api_key', headerScheme: 'bearer' });
    assert.equal(mcp.mcpServers.dotg.url, 'https://synthetic.example.test/mcp');
    assert(!JSON.stringify(mcp).includes(config.mcpBearerToken));
  } finally { rmSync(directory, { recursive: true }); }
});

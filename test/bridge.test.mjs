import test from 'node:test';
import https from 'node:https';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { Resolver, getServers } from 'node:dns/promises';
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
import { publicAddress, callbackPost, callbackResolver } from '../src/security.mjs';
import { telegramClient, TelegramFailure } from '../src/telegram.mjs';
import { createBridgeServer, closeBridgeServer } from '../src/server.mjs';

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

test('latency evidence distinguishes receipt, callback acceptance, first read and first reply', async t => {
  let now = Date.now();
  const { bridge, rpc, store } = fixture(t, { now: () => now });
  await rpc('events/subscribe', subscription());
  bridge.receive(update(), config.telegramWebhookSecret);
  const received = now;
  now += 10;
  await bridge.deliver();
  assert.equal(Object.values(store.read().deliveries)[0].acceptedAt, now);
  assert.equal(Object.values(store.read().deliveries)[0].lastStatus, 200);
  now += 10000;
  await bridge.callTool('read_telegram_message', { message_key: 'telegram_1' });
  const read = now;
  now += 100;
  await bridge.callTool('read_telegram_message', { message_key: 'telegram_1' });
  const reply = { message_key: 'telegram_1', revision: 1, final: true, text: 'Hello.' };
  await bridge.callTool('reply_telegram_message', reply);
  const sent = now;
  now += 500;
  await bridge.callTool('reply_telegram_message', reply);
  const message = store.read().messages.telegram_1;
  assert.equal(message.receivedAt, received);
  assert.equal(message.readAt, read);
  assert.equal(message.firstReplyAt, sent);
});

test('pending recovery is bounded, authorized and excludes final or uncertain writes', async t => {
  const { bridge, store } = fixture(t);
  for (let id = 1; id <= 12; id++) bridge.receive(update(id), config.telegramWebhookSecret);
  store.mutate(state => {
    state.messages.telegram_1.reply = { status: 'sent', final: true };
    state.messages.telegram_2.reply = { status: 'uncertain', final: false };
    state.messages.telegram_3.reply = { status: 'pending', final: false };
    state.messages.telegram_4.owner = 'another-owner';
    state.messages.telegram_5.chatId = '999';
    state.messages.telegram_6.reply = { status: 'sent', final: false };
  });
  const result = await bridge.callTool('get_bridge_status', {});
  assert.deepEqual(result.pending_messages.map(item => item.message_key), Array.from({ length: 7 }, (_, i) => `telegram_${i + 6}`));
  assert.equal('text' in result.pending_messages[0], false);
  for (let id = 13; id <= 20; id++) bridge.receive(update(id), config.telegramWebhookSecret);
  assert.equal((await bridge.callTool('get_bridge_status', {})).pending_messages.length, 8);
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

test('approved snapshot recovery requires a new signed challenge even with the same recent secret', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'dotg-recovery-test-'));
  let recovered;
  t.after(() => { recovered?.close(); rmSync(directory, { recursive: true, force: true }); });
  const source = join(directory, 'source.sqlite');
  const snapshot = join(directory, 'snapshot');
  const restored = join(directory, 'restored');
  const original = new Store(source);
  const posts = [];
  const post = async (url, body, signedHeaders) => {
    const value = new Webhook(signingSecret).verify(body, signedHeaders);
    posts.push(value);
    return { status: 200, body: JSON.stringify({ challenge: value.challenge }) };
  };
  try {
    const bridge = new Bridge({ store: original, config, telegram: async () => { throw new Error('No Telegram writes allowed'); }, post });
    await bridge.rpc({ jsonrpc: '2.0', id: 1, method: 'events/subscribe', params: subscription() }, headers);
  } finally { original.close(); }
  const run = args => execFileSync('python3', ['scripts/backup.py', ...args], { timeout: 10000 });
  run(['create', '--database', source, '--destination', snapshot]);
  run(['restore', '--snapshot', snapshot, '--destination', restored]);
  run(['approve-restore', '--directory', restored, '--reviewed-external-state']);
  recovered = new Store(join(restored, 'state.sqlite'));
  const state = recovered.read();
  assert.equal(Object.values(state.subscriptions)[0].verifiedAt, 0);
  const now = Math.max(Date.now(), state.recovery.restoredAt + 1);
  const bridge = new Bridge({ store: recovered, config, telegram: async () => { throw new Error('No Telegram writes allowed'); }, post, now: () => now });
  await bridge.rpc({ jsonrpc: '2.0', id: 1, method: 'events/subscribe', params: subscription() }, headers);
  assert.equal(posts.length, 2, 'recovery must not reuse the original verification cache');
  assert.notEqual(posts[0].challenge, posts[1].challenge);
  const renewed = Object.values(recovered.read().subscriptions)[0];
  assert.ok(renewed.verifiedAt > state.recovery.restoredAt);
  assert.ok(renewed.expiresAt > now);
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
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fc00::1', '192.0.2.1', '198.18.9.172']) assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress('8.8.8.8'), true);
  const resolver = async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }];
  await assert.rejects(callbackPost('https://example.test', '{}', {}, resolver), /Unsafe/);
  const credentialUrl = new URL('https://example.test');
  credentialUrl.username = 'synthetic-user';
  for (const url of ['http://example.test', credentialUrl.href, 'https://example.test:444', 'https://example.test/#fragment']) await assert.rejects(callbackPost(url, '{}', {}, resolver), /Unsafe/);
});

test('dedicated callback DNS preserves mixed-address rejection and global settings', async t => {
  const before = getServers();
  t.mock.method(Resolver.prototype, 'resolve4', async () => ['8.8.8.8']);
  t.mock.method(Resolver.prototype, 'resolve6', async () => ['::1']);
  const resolver = callbackResolver('1.1.1.1');
  assert.deepEqual(getServers(), before);
  await assert.rejects(callbackPost('https://callback.example.test', '{}', {}, resolver), /Unsafe callback address/);
  assert.deepEqual(await resolver('127.0.0.1'), [{ address: '127.0.0.1', family: 4 }]);
  assert.throws(() => callbackResolver('1.1.1.1,'), /Invalid callback DNS/);
});

test('dedicated callback DNS accepts absent IPv6 but fails closed on DNS errors', async t => {
  t.mock.method(Resolver.prototype, 'resolve4', async () => ['8.8.8.8']);
  const ipv6 = t.mock.method(Resolver.prototype, 'resolve6', async () => { throw Object.assign(new Error(), { code: 'ENODATA' }); });
  const resolver = callbackResolver('1.1.1.1');
  assert.deepEqual(await resolver('callback.example.test'), [{ address: '8.8.8.8', family: 4 }]);
  ipv6.mock.mockImplementation(async () => { throw Object.assign(new Error(), { code: 'ETIMEOUT' }); });
  await assert.rejects(resolver('callback.example.test'), /Callback DNS lookup failed/);
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
  t.after(() => closeBridgeServer(server));
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
  const directory = mkdtempSync(join(tmpdir(), 'dolegram-package-test-'));
  try {
    const output = join(directory, 'dolegram');
    execFileSync('python3', ['scripts/prepare-plugin.py', '--endpoint', 'https://synthetic.example.test/mcp', '--output', output]);
    const manifest = JSON.parse(readFileSync(join(output, 'plugin.json'), 'utf8'));
    const mcp = JSON.parse(readFileSync(join(output, 'mcp.json'), 'utf8'));
    assert.equal(manifest.name, 'dolegram');
    assert.deepEqual(mcp.mcpServers.dolegram.extensions['com.openai'].auth, { type: 'api_key', headerScheme: 'bearer' });
    assert.equal(mcp.mcpServers.dolegram.url, 'https://synthetic.example.test/mcp');
    assert(!JSON.stringify(mcp).includes(config.mcpBearerToken));
  } finally { rmSync(directory, { recursive: true }); }
});

test('stored message ownership is enforced even if the owner changes with the same allowlist', async t => {
  const { bridge, store } = fixture(t);
  bridge.receive(update(), config.telegramWebhookSecret);
  const otherOwner = new Bridge({ store, config: { ...config, ownerId: 'different-test-owner' }, telegram: async () => { throw new Error('Must not send'); } });
  await assert.rejects(otherOwner.callTool('read_telegram_message', { message_key: 'telegram_1' }), /unavailable/);
  await assert.rejects(otherOwner.callTool('reply_telegram_message', { message_key: 'telegram_1', text: 'Wrong owner', revision: 1, final: true }), /unavailable/);
  assert.equal((await otherOwner.callTool('get_bridge_status', {})).messages, 0);
});

test('concurrent HTTP replies cannot create two Telegram messages', async t => {
  const { bridge, calls } = fixture(t);
  bridge.receive(update(), config.telegramWebhookSecret);
  const server = createBridgeServer(bridge);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => closeBridgeServer(server));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  const send = async (text, revision = 1, final = false) => {
    const result = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: revision === 1 ? 'reply_telegram_message' : 'update_telegram_message', arguments: { message_key: 'telegram_1', text, revision, final } } }) });
    return (await result.json()).result;
  };
  const results = await Promise.all([send('First useful answer.'), send('Competing useful answer.')]);
  assert.equal(results.filter(result => result.isError).length, 1);
  assert.equal(calls.length, 1);
  const firstText = calls[0].params.text;
  const edits = await Promise.all([send(firstText + ' More useful detail A.', 2), send(firstText + ' More useful detail B.', 2)]);
  assert.equal(edits.filter(result => result.isError).length, 1);
  assert.equal(calls.length, 2);
  assert.equal((await send(calls[1].params.text + ' Final useful detail.', 3, true)).isError, undefined);
  assert.deepEqual(calls.map(call => call.method), ['sendMessage', 'editMessageText', 'editMessageText']);
  assert.equal(calls[1].params.message_id, calls[2].params.message_id);
});

test('webhook storage failure returns 500 so Telegram can retry', async t => {
  const { bridge, store } = fixture(t);
  const server = createBridgeServer(bridge);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => closeBridgeServer(server));
  t.mock.method(store, 'mutate', () => { throw new Error('Synthetic storage failure'); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/telegram/webhook`, {
    method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': config.telegramWebhookSecret }, body: JSON.stringify(update()),
  });
  assert.equal(response.status, 500);
  assert(!JSON.stringify(await response.json()).includes('storage'));
});


test('split UTF-8 request chunks preserve the exact Telegram text', async t => {
  const { bridge, store } = fixture(t);
  const server = createBridgeServer(bridge);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => closeBridgeServer(server));
  const value = update();
  value.message.text = 'Synthetic emoji: \u{1F331}';
  const body = Buffer.from(JSON.stringify(value));
  const split = body.indexOf(Buffer.from('\u{1F331}')) + 1;
  const status = await new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port: server.address().port, path: '/telegram/webhook', method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': config.telegramWebhookSecret } }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    request.write(body.subarray(0, split));
    setImmediate(() => request.end(body.subarray(split)));
  });
  assert.equal(status, 200);
  assert.equal(store.read().messages.telegram_1.text, value.message.text);
});

test('Standard Webhooks checks the signing timestamp, not event occurrence time', () => {
  const signer = new Webhook(signingSecret);
  const body = JSON.stringify({ eventId: 'synthetic-id', timestamp: '2000-01-01T00:00:00Z' });
  const old = new Date(Date.now() - 600000);
  const signedHeaders = { 'webhook-id': 'synthetic-id', 'webhook-timestamp': String(Math.floor(old.getTime() / 1000)), 'webhook-signature': signer.sign('synthetic-id', old, body) };
  assert.throws(() => signer.verify(body, signedHeaders));
  const fresh = new Date();
  signedHeaders['webhook-timestamp'] = String(Math.floor(fresh.getTime() / 1000));
  signedHeaders['webhook-signature'] = signer.sign('synthetic-id', fresh, body);
  assert.equal(signer.verify(body, signedHeaders).eventId, 'synthetic-id');
});

test('isolated HTTP workflow subscribes, receives, signs and edits one synthetic reply', async t => {
  const { bridge, calls, posts } = fixture(t);
  const server = createBridgeServer(bridge);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => closeBridgeServer(server));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const rpc = async (method, params) => {
    const response = await fetch(`${origin}/mcp`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    assert.equal(response.status, 200);
    const value = await response.json();
    assert.equal(value.error, undefined);
    return value.result;
  };
  const created = await rpc('events/subscribe', subscription());
  assert.equal(posts[0].value.type, 'verification');
  const received = await fetch(`${origin}/telegram/webhook`, { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': config.telegramWebhookSecret }, body: JSON.stringify(update()) });
  assert.equal((await received.json()).accepted, true);
  await bridge.deliver();
  const delivered = posts.find(post => post.value.name === EVENT_NAME);
  assert(delivered);
  assert.equal(delivered.headers['X-MCP-Subscription-Id'], created.id);
  const verified = new Webhook(signingSecret).verify(delivered.body, delivered.headers);
  const messageKey = verified.data.message_key;
  const message = await rpc('tools/call', { name: 'read_telegram_message', arguments: { message_key: messageKey } });
  assert.equal(JSON.parse(message.content[0].text).text, update().message.text);
  let text = 'First useful formal content.';
  for (const revision of [1, 2, 3]) {
    const result = await rpc('tools/call', { name: revision === 1 ? 'reply_telegram_message' : 'update_telegram_message', arguments: { message_key: messageKey, text, revision, final: revision === 3 } });
    assert.equal(result.isError, undefined);
    text += ' Additional useful content.';
  }
  assert.deepEqual(calls.map(call => call.method), ['sendMessage', 'editMessageText', 'editMessageText']);
  assert(calls.slice(1).every(call => call.params.message_id === 77));
  await rpc('events/unsubscribe', subscription());
  assert.equal((await bridge.callTool('get_bridge_status', {})).subscriptions, 0);
});

test('partial answers can be read and resumed by a new bridge instance', async t => {
  const { bridge, store, calls } = fixture(t);
  bridge.receive(update(), config.telegramWebhookSecret);
  await bridge.callTool('reply_telegram_message', { message_key: 'telegram_1', revision: 1, text: 'First.', final: false });
  const resumed = new Bridge({ store, config, telegram: bridge.telegram });
  const message = await resumed.callTool('read_telegram_message', { message_key: 'telegram_1' });
  assert.equal(message.reply.text, 'First.');
  assert.equal(message.reply.messageId, 77);
  await resumed.callTool('update_telegram_message', { message_key: 'telegram_1', revision: 2, text: message.reply.text + ' Second.', final: false });
  await resumed.callTool('update_telegram_message', { message_key: 'telegram_1', revision: 3, text: message.reply.text + ' Second. Third.', final: true });
  assert.equal(calls.filter(call => call.method === 'sendMessage').length, 1);
  assert.ok(calls.slice(1).every(call => call.params.message_id === 77));
});

test('a late 410 cannot delete a refreshed Node subscription', async t => {
  let now = Date.now();
  const { bridge, rpc, store } = fixture(t, { now: () => now });
  const sub = await rpc('events/subscribe', subscription());
  bridge.receive(update(), config.telegramWebhookSecret);
  let release;
  bridge.post = async () => new Promise(resolve => { release = resolve; });
  const delivery = bridge.deliver();
  store.mutate(state => { state.subscriptions[sub.id].secret = replacementSecret; });
  release({ status: 410 });
  await delivery;
  assert.equal(store.read().subscriptions[sub.id].secret, replacementSecret);
  assert.equal(Object.values(store.read().deliveries)[0].done, false);
  now += 3000;
  bridge.post = async () => ({ status: 200 });
  await bridge.deliver();
  assert.equal(Object.values(store.read().deliveries)[0].acceptedAt > 0, true);
});

test('shutdown waits for a late queued RPC after its client disconnects', async t => {
  const { bridge } = fixture(t);
  let release;
  let started;
  const running = new Promise(resolve => { started = resolve; });
  bridge.rpc = async () => { started(); await new Promise(resolve => { release = resolve; }); return {}; };
  const server = createBridgeServer(bridge);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const received = new Promise(resolve => server.once('request', resolve));
  const request = http.request({ host: '127.0.0.1', port: server.address().port, path: '/mcp', method: 'POST',
    headers: { 'Content-Length': Buffer.byteLength(body) } });
  request.on('error', () => {});
  request.write(body.slice(0, -1));
  await received;
  let closed = false;
  const closing = closeBridgeServer(server).then(() => { closed = true; });
  request.end(body.slice(-1));
  await running;
  request.destroy();
  await new Promise(resolve => server.once('close', resolve));
  await new Promise(resolve => setImmediate(resolve));
  try { assert.equal(closed, false); }
  finally { release(); await closing; }
});

test('slow callback delivery does not block MCP and shutdown drains the callback', async t => {
  const { bridge, store, rpc } = fixture(t);
  await rpc('events/subscribe', subscription());
  let release;
  let started;
  const didStart = new Promise(resolve => { started = resolve; });
  bridge.post = async () => { started(); return new Promise(resolve => { release = resolve; }); };
  const server = createBridgeServer(bridge);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  bridge.receive(update(), config.telegramWebhookSecret);
  await didStart;
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/mcp`, { method: 'POST', headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_bridge_status', arguments: {} } }), signal: AbortSignal.timeout(1000) });
    assert.equal(response.status, 200);
    assert.equal(JSON.parse((await response.json()).result.content[0].text).messages, 1);
    let closed = false;
    const closing = closeBridgeServer(server).then(() => { closed = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(closed, false);
    release({ status: 200 });
    await closing;
    assert.equal(Object.values(store.read().deliveries)[0].done, true);
  } finally {
    release({ status: 200 });
    if (server.listening) await closeBridgeServer(server);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Webhook } from 'standardwebhooks';
import worker, { createSitesWorker } from '../src/sites/worker.mjs';
import { SignedCallbacks, exactOriginPolicy } from '../src/sites/callbacks.mjs';
import { SitesStore } from '../src/sites/d1-store.mjs';
import { EVENT_NAME } from '../src/contracts.mjs';

// A local SQL-backed double for the documented D1 binding surface, not a hosted D1 test.
class LocalD1 {
  constructor(path = ':memory:', migrate = true) {
    this.sqlite = new DatabaseSync(path);
    if (migrate) this.sqlite.exec(readFileSync('sites/migrations/0001_bridge.sql', 'utf8'));
  }
  prepare(sql) {
    const bind = (...values) => {
      const execute = () => {
        const statement = this.sqlite.prepare(sql);
        if (statement.columns().length) return { results: statement.all(...values), meta: { changes: 0 } };
        return { results: [], meta: { changes: Number(statement.run(...values).changes) } };
      };
      return { bind, execute, run: async () => execute(), all: async () => execute(), first: async () => execute().results[0] ?? null };
    };
    return bind();
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try { const result = statements.map(statement => statement.execute()); this.sqlite.exec('COMMIT'); return result; }
    catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
  close() { this.sqlite.close(); }
}

const origin = 'https://callback.example.test';
const signingSecret = `whsec_${Buffer.alloc(32, 9).toString('base64')}`;
const subscribe = { name: EVENT_NAME, arguments: { chat_id: '123' }, delivery: { mode: 'webhook', url: origin + '/events/synthetic', secret: signingSecret } };
const update = () => ({ update_id: 1, message: { message_id: 5, date: Math.floor(Date.now() / 1000), from: { id: 123, is_bot: false }, chat: { id: 123, type: 'private' }, text: 'Synthetic private message.' } });
const setup = (t, options = {}) => {
  const db = new LocalD1();
  t.after(() => db.close());
  const sent = [];
  const posts = [];
  const env = { DB: db, OWNER_USER_ID: 'synthetic-owner', TELEGRAM_BOT_TOKEN: 'synthetic-token', TELEGRAM_WEBHOOK_SECRET: 'w'.repeat(32), ALLOWED_CHAT_IDS_JSON: '["123"]' };
  const callbacks = async (url, body, headers) => {
    const value = new Webhook(signingSecret).verify(body, headers);
    posts.push({ url, body, headers, value });
    return { status: 200, body: JSON.stringify({ challenge: value.challenge }) };
  };
  const optionsFor = overrides => ({ callbackOrigins: [origin], callbackPost: callbacks,
    telegramFactory: () => async (method, params) => { sent.push({ method, params }); return { message_id: 77 }; }, ...options, ...overrides });
  const app = createSitesWorker(optionsFor({}));
  const rpc = async (method, params, overrideEnv = env, appOverride = app) => {
    const response = await appOverride.fetch(new Request('https://site.example.test/mcp', { method: 'POST', headers: { 'oai-authenticated-user-id': overrideEnv.OWNER_USER_ID }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }), overrideEnv);
    return { status: response.status, value: await response.json() };
  };
  const intake = async (value = update()) => {
    const response = await app.fetch(new Request('https://site.example.test/telegram/webhook', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': env.TELEGRAM_WEBHOOK_SECRET }, body: JSON.stringify(value) }), env);
    return { status: response.status, value: await response.json() };
  };
  return { app, env, db, sent, posts, rpc, intake, optionsFor };
};

test('Sites production entry fails closed without a verified callback transport or guessed hosts', async t => {
  const { env, rpc, db } = setup(t);
  const response = await rpc('events/subscribe', subscribe, env, worker);
  assert.equal(response.value.error.code, -32015);
  assert.equal(response.value.error.data.reason, 'callback_transport_unverified');
  assert.equal(db.sqlite.prepare('SELECT count(*) AS count FROM dotg_subscriptions').get().count, 0);
  const status = await rpc('tools/call', { name: 'get_bridge_status', arguments: {} }, env, worker);
  assert.equal(JSON.parse(status.value.result.content[0].text).callbackReady, false);
  const webhook = await worker.fetch(new Request('https://site.example.test/telegram/webhook', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': env.TELEGRAM_WEBHOOK_SECRET }, body: JSON.stringify(update()) }), env);
  assert.equal(webhook.status, 503);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS count FROM dotg_messages').get().count, 0);
});

test('fixed-origin validation rejects wildcard, suffix, userinfo, IP and non-HTTPS destinations', () => {
  const allow = exactOriginPolicy([origin]);
  assert.equal(allow(origin + '/events/one').origin, origin);
  for (const url of ['http://callback.example.test', origin + '.evil.test/events', 'https://127.0.0.1/events', 'https://callback.example.test:444/events', origin + '/events#fragment']) assert.throws(() => allow(url));
  const userinfo = new URL(origin); userinfo.username = 'synthetic-user';
  assert.throws(() => allow(userinfo.href));
  for (const bad of ['https://*.example.test', 'https://127.0.0.1', 'https://[::1]', 'https://localhost', 'https://callback.example.test/']) assert.throws(() => exactOriginPolicy([bad]));
});

test('callback policy rejects unknown hosts before transport and rejects redirect responses', async () => {
  let count = 0;
  const callbacks = new SignedCallbacks({ origins: [origin], post: async () => { count++; return { status: 302, body: '' }; } });
  await assert.rejects(callbacks.verify({ id: 'sub_synthetic', url: 'https://untrusted.example.test', secret: signingSecret }), /untrusted_callback_origin/);
  assert.equal(count, 0);
  await assert.rejects(callbacks.verify({ id: 'sub_synthetic', url: origin, secret: signingSecret }), /redirect_rejected/);
  assert.equal(count, 1);
});

test('Sites mock workflow uses D1, authenticated identity and signed official events', async t => {
  const { rpc, intake, posts, sent } = setup(t);
  const discovery = await rpc('server/discover');
  assert.deepEqual(discovery.value.result.supportedVersions, ['2026-07-28']);
  const created = await rpc('events/subscribe', subscribe);
  assert(created.value.result.id);
  const received = await intake();
  assert.equal(received.status, 200);
  assert.equal(received.value.accepted, true);
  assert.equal(posts[0].value.type, 'verification');
  assert.equal(posts[1].value.name, EVENT_NAME);
  const key = posts[1].value.data.message_key;
  for (const revision of [1, 2, 3]) {
    const result = await rpc('tools/call', { name: revision === 1 ? 'reply_telegram_message' : 'update_telegram_message', arguments: { message_key: key, text: 'Useful content.'.repeat(revision), revision, final: revision === 3 } });
    assert.equal(result.value.result.isError, undefined);
  }
  assert.deepEqual(sent.map(call => call.method), ['sendMessage', 'editMessageText', 'editMessageText']);
  assert(sent.slice(1).every(call => call.params.message_id === 77));
  await rpc('events/unsubscribe', subscribe);
});

test('Sites owner identity, webhook secret and private chat allowlist are mandatory', async t => {
  const { app, env, intake } = setup(t);
  for (const headers of [{}, { 'oai-authenticated-user-id': 'different-owner' }, { authorization: 'Bearer synthetic-token' }]) {
    const response = await app.fetch(new Request('https://site.example.test/mcp', { method: 'POST', headers, body: '{}' }), env);
    assert.equal(response.status, 401);
  }
  const unauthenticated = await app.fetch(new Request('https://site.example.test/telegram/webhook', { method: 'POST', body: '{}' }), env);
  assert.equal(unauthenticated.status, 401);
  const otherChat = update(); otherChat.message.chat.id = 999;
  assert.equal((await intake(otherChat)).value.ignored, true);
  const group = update(); group.message.chat.type = 'group';
  assert.equal((await intake(group)).value.ignored, true);
});

test('concurrent invocations atomically accept one update and one reply revision', async t => {
  const { rpc, intake, sent, db } = setup(t);
  await rpc('events/subscribe', subscribe);
  const incoming = await Promise.all([intake(), intake()]);
  assert.equal(incoming.filter(value => value.value.accepted).length, 1);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS count FROM dotg_outbox').get().count, 1);
  const args = { message_key: 'telegram_1', text: 'Useful first content.', revision: 1, final: false };
  const replies = await Promise.all([rpc('tools/call', { name: 'reply_telegram_message', arguments: args }), rpc('tools/call', { name: 'reply_telegram_message', arguments: { ...args, text: 'Competing useful content.' } })]);
  assert.equal(replies.filter(value => value.value.result.isError).length, 1);
  assert.equal(sent.length, 1);
  const prior = sent[0].params.text;
  const edits = await Promise.all([' A.', ' B.'].map(part => rpc('tools/call', { name: 'update_telegram_message', arguments: { ...args, revision: 2, text: prior + part } })));
  assert.equal(edits.filter(value => value.value.result.isError).length, 1);
  assert.equal(sent.length, 2);
});

test('D1 batch rolls back message acceptance if atomic outbox creation fails', async t => {
  const { db, intake } = setup(t);
  db.sqlite.exec('DROP TABLE dotg_outbox');
  assert.equal((await intake()).status, 500);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS count FROM dotg_messages').get().count, 0);
});

test('scheduled flush resumes persisted retry state across Worker invocations without waitUntil', async t => {
  let now = Date.now();
  let status = 503;
  const events = [];
  const { env, intake, rpc, optionsFor, posts } = setup(t, { now: () => now, callbackPost: async (_url, body, headers) => {
    const value = JSON.parse(body);
    if (value.type === 'verification') return { status: 200, body: JSON.stringify({ challenge: value.challenge }) };
    events.push({ value, headers }); return { status, body: '' };
  } });
  await rpc('events/subscribe', subscribe);
  await intake();
  assert.equal(events.length, 1);
  now += 4000;
  status = 200;
  const restartedWorker = createSitesWorker(optionsFor({ now: () => now, callbackPost: async (_url, body, headers) => { events.push({ value: JSON.parse(body), headers }); return { status, body: '' }; } }));
  const flushed = await rpc('tools/call', { name: 'flush_event_deliveries', arguments: {} }, env, restartedWorker);
  assert.equal(flushed.value.result.isError, undefined);
  assert.equal(events.length, 2);
  assert.equal(events[0].value.eventId, events[1].value.eventId);
  assert.notEqual(events[0].headers['webhook-signature'], events[1].headers['webhook-signature']);
  assert.equal(posts.length, 0);
});

test('uncertain reply claims survive process restart and remain owner-isolated', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dotg-sites-'));
  const path = join(directory, 'test.sqlite');
  let db = new LocalD1(path);
  try {
    const first = new SitesStore(db, 'owner-a');
    await first.receive({ message_key: 'telegram_1', chat_id: '123', message_id: 1, text: 'Synthetic content.' }, new Date().toISOString(), Date.now());
    assert(await first.claimReply('telegram_1', 0, Date.now()));
    db.close(); db = new LocalD1(path, false);
    const reopened = new SitesStore(db, 'owner-a');
    assert.equal(await reopened.claimReply('telegram_1', 0, Date.now()), null);
    assert.equal((await reopened.counts()).uncertainReplies, 1);
    assert.equal(await new SitesStore(db, 'owner-b').message('telegram_1'), null);
  } finally { db.close(); rmSync(directory, { recursive: true }); }
});


test('an old delivery cannot remove a concurrently refreshed subscription', async t => {
  let now = Date.now();
  const { env, rpc, intake, db } = setup(t, { now: () => now, callbackPost: async (_url, body) => {
    const value = JSON.parse(body);
    return { status: value.type ? 200 : 503, body: JSON.stringify({ challenge: value.challenge }) };
  } });
  const created = await rpc('events/subscribe', subscribe);
  await intake();
  now += 4000;
  const store = new SitesStore(db, env.OWNER_USER_ID);
  const old = await store.subscription(created.value.result.id);
  const [{ id }] = await store.due(now);
  const claimed = await store.claimDelivery(id, now);
  await store.saveSubscription({ ...old, verified_at: now, expires_at: old.expires_at + 10000 });
  await store.finishDelivery(claimed, 410, now, old);
  assert.equal((await store.subscription(old.id)).verified_at, now);
});

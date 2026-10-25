import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { summarizeDiagnostics } from '../src/diagnostics.mjs';
import { runDoctor, assessDiagnostics, readHealthAddress } from '../src/doctor.mjs';
import { Bridge } from '../src/bridge.mjs';
import { Store } from '../src/store.mjs';
import { createBridgeServer, closeBridgeServer } from '../src/server.mjs';

const config = { ownerId: 'synthetic-owner', allowedChatIds: ['123'], mcpBearerToken: 'synthetic-bearer-'.repeat(3),
  telegramMode: 'polling', expectedBotId: '456', expectedBotUsername: 'synthetic_bot', telegramBotToken: 'synthetic-bot-secret' };
const now = 1000000;
function stateFixture() {
  const message = (key, extra = {}) => ({ messageKey: key, owner: config.ownerId, chatId: '123', text: 'PRIVATE MESSAGE', receivedAt: now - 100, ...extra });
  const messages = Object.fromEntries(['missing', 'queued', 'failed', 'waiting', 'reading', 'partial', 'writing', 'uncertain', 'complete'].map(key => [key, message(key)]));
  Object.assign(messages.reading, { readAt: now - 20 });
  Object.assign(messages.partial, { reply: { status: 'sent', final: false } });
  Object.assign(messages.writing, { reply: { status: 'pending' } });
  Object.assign(messages.uncertain, { reply: { status: 'uncertain' } });
  Object.assign(messages.complete, { readAt: now - 50, firstReplyAt: now - 10, reply: { status: 'sent', final: true, sentAt: now } });
  messages.foreign = message('foreign', { owner: 'someone-else' });
  messages.denied = message('denied', { chatId: '999' });
  const delivery = (key, extra = {}) => ({ subscriptionId: 'sub', event: { data: { message_key: key, text: 'PRIVATE MESSAGE' } }, ...extra });
  return { messages, subscriptions: { sub: { id: 'sub', owner: config.ownerId, chatId: '123', expiresAt: now + 600000, secret: 'PRIVATE SIGNING SECRET', url: 'https://private.invalid' } },
    deliveries: { queued: delivery('queued'), failed: delivery('failed', { done: true }), waiting: delivery('waiting', { acceptedAt: now - 60 }), complete: delivery('complete', { acceptedAt: now - 80 }) } };
}

test('diagnostics distinguish every delivery stage without exposing private data or mutating state', () => {
  const state = stateFixture();
  const before = structuredClone(state);
  const result = summarizeDiagnostics(state, config, now, { state: 'disabled' });
  assert.deepEqual(Object.values(result.stages), Array(9).fill(1));
  assert.equal(result.oldestPendingAt, now - 100);
  assert.equal(result.lastCompletedAt, now);
  assert.deepEqual(result.latency.callbackToReadMs, { samples: 1, median: 30, max: 30 });
  assert.deepEqual(state, before);
  for (const privateValue of ['PRIVATE', config.ownerId, 'private.invalid', 'foreign']) assert.equal(JSON.stringify(result).includes(privateValue), false);
});

test('expired subscription makes undelivered events actionable; accepted events stay waiting for Dot', () => {
  const state = stateFixture();
  state.subscriptions.sub.expiresAt = now - 1;
  const d = summarizeDiagnostics(state, config, now, { state: 'stopped', reason: 'conflict' });
  assert.equal(d.stages.callbackPending, 0);
  assert.equal(d.stages.callbackFailed, 2);
  assert.equal(d.stages.waitingForDot, 1);
  const checks = assessDiagnostics(d, now);
  assert.equal(checks.find(check => check.id === 'subscription').level, 'fail');
  assert.match(checks.find(check => check.id === 'intake').action, /competing consumer/);
  assert.equal(checks.find(check => check.id === 'replies').level, 'fail');
});

test('diagnostics flag uncovered chats, stale polling and missing schema without inventing health', () => {
  const d = summarizeDiagnostics({ messages: {}, deliveries: {}, subscriptions: {} }, config, now, { state: 'polling', lastSuccessAt: now - 100000 });
  assert.equal(assessDiagnostics(d, now).find(check => check.id === 'intake').level, 'warn');
  assert.equal(assessDiagnostics(d, now).find(check => check.id === 'acceptance').level, 'warn');
  assert.equal(assessDiagnostics({ version: 1, stages: 'secret' }, now)[0].id, 'diagnostics');
  const state = stateFixture();
  const multi = summarizeDiagnostics(state, { ...config, allowedChatIds: ['123', '456'] }, now, { state: 'polling', lastSuccessAt: now });
  assert.equal(assessDiagnostics(multi, now).find(check => check.id === 'subscription').level, 'fail');
  const repeated = summarizeDiagnostics(state, { ...config, allowedChatIds: ['123', '123'] }, now, { state: 'polling', lastSuccessAt: now });
  assert.equal(assessDiagnostics(repeated, now).find(check => check.id === 'subscription').level, 'ok');
});

test('doctor performs authenticated discovery and status on isolated HTTP server without writes', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'dotg-doctor-'));
  const configPath = join(dir, 'config.json');
  writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
  const store = new Store(':memory:');
  const bridge = new Bridge({ store, config, telegram: async () => { throw new Error('Must not call Telegram'); } });
  const server = createBridgeServer(bridge);
  t.after(async () => { await closeBridgeServer(server); store.close(); rmSync(dir, { recursive: true, force: true }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const before = store.read();
  const report = await runDoctor({ configPath, backend: `http://127.0.0.1:${server.address().port}` });
  assert.equal(report.checks.find(check => check.id === 'backend').level, 'ok');
  assert.equal(report.checks.find(check => check.id === 'subscription').level, 'fail');
  assert.deepEqual(store.read(), before);
  for (const secret of [config.ownerId, config.mcpBearerToken, config.telegramBotToken, config.expectedBotUsername]) assert.equal(JSON.stringify(report).includes(secret), false);
});

test('doctor redacts failures and refuses redirects, oversized responses and nonloopback destinations', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'dotg-doctor-errors-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const configPath = join(dir, 'config.json');
  writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
  for (const response of [() => { throw new Error('PRIVATE transport'); }, () => new Response('PRIVATE unauthorized', { status: 401 }), () => new Response('x'.repeat(262145))]) {
    const report = await runDoctor({ configPath, request: async (_url, options) => {
      assert.equal(options.redirect, 'error'); assert.ok(options.signal); return response();
    } });
    assert.equal(report.level, 'fail');
    assert.equal(JSON.stringify(report).includes('PRIVATE'), false);
  }
  let requests = 0;
  const report = await runDoctor({ configPath, backend: 'https://example.invalid', request: async () => { requests++; throw new Error('Unexpected'); } });
  assert.equal(report.level, 'fail'); assert.equal(requests, 0);
  chmodSync(configPath, 0o644);
  await runDoctor({ configPath, request: async () => { requests++; throw new Error('Unexpected'); } });
  assert.equal(requests, 0);
});

test('health files reject writable files, symlinks, credentials and nonloopback targets', t => {
  const dir = mkdtempSync(join(tmpdir(), 'dotg-health-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'health.url');
  for (const value of ['https://127.0.0.1:1234', 'http://localhost:1234', 'http://127.0.0.1:1234/?secret=x', 'http://secret@127.0.0.1:1234', 'http://127.0.0.1:1234/redirect', 'http://169.254.169.254']) {
    writeFileSync(path, value, { mode: 0o600 }); assert.throws(() => readHealthAddress(path));
  }
  writeFileSync(path, 'http://127.0.0.1:1234\n');
  assert.equal(readHealthAddress(path), 'http://127.0.0.1:1234');
  symlinkSync(path, join(dir, 'link')); assert.throws(() => readHealthAddress(join(dir, 'link')));
  chmodSync(path, 0o666); assert.throws(() => readHealthAddress(path));
});

test('wrong FIFO paths fail promptly instead of hanging before file validation', { skip: process.platform === 'win32' }, t => {
  const dir = mkdtempSync(join(tmpdir(), 'dotg-fifo-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const fifo = join(dir, 'invalid-file');
  execFileSync('mkfifo', [fifo]);
  // A child timeout makes this regression bounded even if blocking open returns.
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { readHealthAddress } from ${JSON.stringify(new URL('../src/doctor.mjs', import.meta.url).href)};
    import { loadConfig } from ${JSON.stringify(new URL('../src/config.mjs', import.meta.url).href)};
    for (const read of [readHealthAddress, loadConfig]) {
      let rejected = false;
      try { read(process.argv[1]); } catch { rejected = true; }
      if (!rejected) process.exit(1);
    }
  `, fifo], { timeout: 2000 });
});

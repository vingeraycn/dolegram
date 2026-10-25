import test from 'node:test';
import assert from 'node:assert/strict';
import { TelegramActivity } from '../src/activity.mjs';

function fixture() {
  let now = 1000000;
  const message = { owner: 'owner', chatId: '123', messageId: 10, receivedAt: now, reply: null };
  const calls = [];
  const state = { messages: { one: message } };
  const activity = new TelegramActivity({ store: { read: () => state }, config: { ownerId: 'owner', allowedChatIds: ['123'] },
    telegram: async (method, params) => { calls.push({ method, params }); return true; }, now: () => now });
  return { activity, message, calls, advance: ms => { now += ms; }, now: () => now };
}

test('one draft changes from queued to native Thinking; typing only covers processing', async () => {
  const { activity, message, calls, advance, now } = fixture();
  await activity.tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'sendMessageDraft');
  assert.equal(calls[0].params.text, '⏳ Message delivered. Waiting for the system to forward it to Dot.');
  const draftId = calls[0].params.draft_id;
  advance(3000);
  await activity.tick();
  assert.equal(calls.length, 1, 'queued messages must not claim typing');
  message.readAt = now();
  advance(3000);
  await activity.tick();
  assert.equal(calls[1].method, 'sendChatAction');
  assert.equal(calls[2].method, 'sendMessageDraft');
  assert.equal(calls[2].params.text, '');
  assert.equal(calls[2].params.draft_id, draftId);
  advance(3000);
  await activity.tick();
  assert.equal(calls.at(-1).method, 'sendChatAction');
  message.reply = { messageId: 11, status: 'sent', final: false };
  advance(21000);
  await activity.tick();
  assert.equal(calls.at(-1).method, 'sendChatAction');
  const count = calls.length;
  message.reply.final = true;
  advance(4000);
  await activity.tick();
  assert.equal(calls.length, count);
  assert.ok(activity.status().sendChatAction.successes >= 3);
});

test('slow responses have bounded activity; uncertain writes do not show typing', async () => {
  const { activity, message, calls, advance } = fixture();
  message.readAt = message.receivedAt;
  advance(91000);
  await activity.tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'sendMessageDraft');
  assert.equal(calls[0].params.text, 'This is taking longer than expected. Still waiting for a complete reply.');
  advance(100000);
  await activity.tick();
  assert.equal(calls.length, 1);
  const other = fixture();
  other.message.reply = { status: 'uncertain' };
  await other.activity.tick();
  assert.equal(other.calls.length, 1);
  assert.equal(other.calls[0].method, 'sendMessageDraft');
  assert.equal(other.calls[0].params.text, 'Reply delivery is unconfirmed. Awaiting review.');
});

test('draft failure cannot suppress typing; rate limits postpone all feedback', async () => {
  const { activity, calls, advance, message } = fixture();
  message.readAt = message.receivedAt;
  activity.telegram = async (method, params) => {
    calls.push({ method, params });
    if (method === 'sendMessageDraft') throw { code: 'rejected' };
  };
  await activity.tick();
  assert.equal(activity.status().sendChatAction.successes, 1);
  assert.equal(activity.status().sendMessageDraft.lastFailure, 'rejected');
  advance(3000);
  await activity.tick();
  assert.equal(activity.status().sendChatAction.successes, 2);

  const other = fixture();
  other.message.readAt = other.message.receivedAt;
  other.activity.telegram = async () => { other.calls.push({}); throw { code: 'rate_limit', retryAfter: 30 }; };
  await other.activity.tick();
  other.advance(4000);
  await other.activity.tick();
  assert.equal(other.calls.length, 2);
  other.advance(30000);
  await other.activity.tick();
  assert.equal(other.calls.length, 4);
});

test('single-flight feedback is cancelled and drained before reply or shutdown', async () => {
  const { activity, calls, message } = fixture();
  message.readAt = message.receivedAt;
  activity.telegram = async (method, params, signal) => {
    calls.push({ method, params });
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  };
  const running = activity.tick();
  await activity.tick();
  assert.equal(calls.length, 2);
  await activity.beforeReply('123');
  await running;
  assert.equal(activity.status().sendChatAction.failures, 0, 'intentional cancellation is not a transport failure');
  await activity.tick();
  assert.equal(calls.length, 2);
  message.reply = { messageId: 11, status: 'sent', final: true };
  activity.afterReply('123');
  await activity.tick();
  assert.equal(calls.length, 2);

  const other = fixture();
  other.activity.telegram = activity.telegram;
  const pending = other.activity.tick();
  await other.activity.close();
  await pending;
  const count = calls.length;
  await other.activity.tick();
  assert.equal(calls.length, count);
});

test('old records and unauthorized chats cannot emit activity', async () => {
  const { activity, message, calls } = fixture();
  message.chatId = '456';
  await activity.tick();
  message.chatId = '123';
  delete message.receivedAt;
  await activity.tick();
  assert.equal(calls.length, 0);
});

test('a new message gets its own queued draft before the old refresh deadline', async () => {
  const { activity, calls, message, advance, now } = fixture();
  await activity.tick();
  advance(4000);
  message.messageId = 20;
  message.receivedAt = now();
  await activity.tick();
  assert.deepEqual(calls.map(call => call.params.draft_id), [10, 20]);
});

test('formal reply hooks preserve Telegram cooldown', async () => {
  const { activity, calls, message, advance } = fixture();
  message.readAt = message.receivedAt;
  activity.telegram = async () => { calls.push({}); throw { code: 'rate_limit', retryAfter: 30 }; };
  await activity.tick();
  await activity.beforeReply('123');
  message.reply = { messageId: 11, status: 'sent', final: false };
  activity.afterReply('123');
  await activity.tick();
  assert.equal(calls.length, 2);
  advance(30000);
  await activity.tick();
  assert.equal(calls.length, 3);
});

test('a late first read starts a bounded processing window without resetting on restart', async () => {
  const { activity, calls, message, advance, now } = fixture();
  advance(181000);
  await activity.tick();
  assert.equal(calls.length, 0);
  message.readAt = now();
  await activity.tick();
  assert.equal(calls[0].method, 'sendChatAction');
  advance(181000);
  const restarted = new TelegramActivity({ store: activity.store, config: activity.config, telegram: activity.telegram, now });
  await restarted.tick();
  assert.equal(calls.length, 2);
});

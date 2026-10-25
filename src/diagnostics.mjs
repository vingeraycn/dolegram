// Aggregate only: no messages, identifiers, callback URLs or credentials.
export function summarizeDiagnostics(state, config, now, intake) {
  const messages = Object.values(state.messages).filter(message => message.owner === config.ownerId && config.allowedChatIds.includes(message.chatId));
  const subscriptions = Object.values(state.subscriptions).filter(sub => sub.owner === config.ownerId && config.allowedChatIds.includes(sub.chatId) && sub.expiresAt > now);
  const deliveries = new Map();
  for (const delivery of Object.values(state.deliveries)) {
    const key = delivery.event?.data?.message_key;
    const items = deliveries.get(key) ?? [];
    items.push(delivery);
    deliveries.set(key, items);
  }
  const counts = { awaitingSubscription: 0, callbackPending: 0, callbackFailed: 0,
    waitingForDot: 0, processing: 0, partial: 0, writing: 0, uncertain: 0, completed: 0 };
  let oldestPendingAt = null;
  let lastCompletedAt = null;
  const latency = { receiptToCallbackMs: [], callbackToReadMs: [], readToFirstReplyMs: [] };
  const interval = (list, from, to) => {
    if (Number.isFinite(from) && Number.isFinite(to) && to >= from) list.push(to - from);
  };
  // A bounded sample keeps old history from hiding recent scheduling changes.
  const recent = new Set([...messages].sort((a, b) => b.receivedAt - a.receivedAt).slice(0, 100));
  for (const message of messages) {
    const items = deliveries.get(message.messageKey) ?? [];
    const accepted = items.filter(item => Number.isFinite(item.acceptedAt));
    const acceptedAt = accepted.length ? Math.min(...accepted.map(item => item.acceptedAt)) : null;
    const reply = message.reply;
    let stage;
    if (reply?.status === 'uncertain') stage = 'uncertain';
    else if (reply?.status === 'pending') stage = 'writing';
    else if (reply?.status === 'sent') stage = reply.final ? 'completed' : 'partial';
    else if (message.readAt) stage = 'processing';
    else if (acceptedAt !== null) stage = 'waitingForDot';
    else if (!items.length) stage = 'awaitingSubscription';
    else if (items.every(item => item.done || !subscriptions.some(sub => sub.id === item.subscriptionId))) stage = 'callbackFailed';
    else stage = 'callbackPending';
    counts[stage] += 1;
    if (stage === 'completed') lastCompletedAt = Math.max(lastCompletedAt ?? 0, reply.sentAt ?? 0) || null;
    else if (Number.isFinite(message.receivedAt)) oldestPendingAt = Math.min(oldestPendingAt ?? message.receivedAt, message.receivedAt);
    if (recent.has(message)) {
      interval(latency.receiptToCallbackMs, message.receivedAt, acceptedAt);
      interval(latency.callbackToReadMs, acceptedAt, message.readAt);
      interval(latency.readToFirstReplyMs, message.readAt, message.firstReplyAt);
    }
  }
  const summarize = values => {
    values.sort((a, b) => a - b);
    return { samples: values.length, median: values.length ? values[Math.floor((values.length - 1) / 2)] : null,
      max: values.length ? values.at(-1) : null };
  };
  return { version: 1, observedAt: now, intake, stages: counts, oldestPendingAt, lastCompletedAt,
    subscription: { active: subscriptions.length, coveredChats: new Set(subscriptions.map(sub => sub.chatId)).size,
      requiredChats: new Set(config.allowedChatIds).size,
      nextExpiryAt: subscriptions.length ? Math.min(...subscriptions.map(sub => sub.expiresAt)) : null },
    latency: Object.fromEntries(Object.entries(latency).map(([key, values]) => [key, summarize(values)])) };
}

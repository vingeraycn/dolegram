// Ephemeral Telegram feedback is separate from durable, idempotent answers.
// A webhook acknowledgement is not evidence that Dot has started processing.
export class TelegramActivity {
  constructor({ store, config, telegram, now = Date.now }) {
    this.store = store;
    this.config = config;
    this.telegram = telegram;
    this.now = now;
    this.chats = new Map();
    this.diagnostics = {};
    this.closed = false;
  }
  state(chatId) {
    if (!this.chats.has(chatId)) this.chats.set(chatId, { hold: 0, nextAt: 0, retryAt: 0, draftAt: 0, draftMessageId: null, phase: '', job: null });
    return this.chats.get(chatId);
  }
  poke() { void this.tick(); }
  status() { return structuredClone(this.diagnostics); }
  async send(method, params, state) {
    const stats = this.diagnostics[method] ??= { attempts: 0, successes: 0, failures: 0 };
    stats.attempts += 1;
    try {
      await this.telegram(method, params, AbortSignal.any([state.controller.signal, AbortSignal.timeout(8000)]));
      stats.successes += 1;
      stats.lastSuccessAt = this.now();
      return true;
    } catch (error) {
      if (!state.controller.signal.aborted) {
        stats.failures += 1;
        stats.lastFailure = ['rate_limit', 'rejected', 'uncertain'].includes(error.code) ? error.code : 'transport';
      }
      state.retryAt = Math.max(state.retryAt, this.now() + Math.max(3000, (Number(error.retryAfter) || 0) * 1000));
      return false;
    }
  }
  async tick() {
    if (this.closed) return;
    const latest = new Map();
    for (const message of Object.values(this.store.read().messages)) {
      if (message.owner !== this.config.ownerId || !this.config.allowedChatIds.includes(message.chatId) || !message.receivedAt) continue;
      if (message.reply?.final && message.reply.status === 'sent') continue;
      if (!latest.has(message.chatId) || latest.get(message.chatId).receivedAt < message.receivedAt) latest.set(message.chatId, message);
    }
    await Promise.all([...latest.values()].map(message => {
      const state = this.state(message.chatId);
      if (state.hold || state.job || state.nextAt > this.now() || state.retryAt > this.now()) return;
      state.job = this.update(message, state).catch(() => {}).finally(() => { state.job = null; });
      return state.job;
    }));
  }
  async update(message, state) {
    const age = this.now() - (message.readAt ?? message.receivedAt);
    // Restart does not revive old spinners. Late actual replies remain allowed.
    if (age > 180000) return;
    const uncertain = message.reply?.status === 'uncertain';
    const waiting = !message.readAt;
    const slow = this.now() - (message.readAt ?? message.receivedAt) > 90000;
    const phase = uncertain ? 'uncertain' : slow ? 'slow' : waiting ? 'queued' : 'processing';
    const hasReply = Boolean(message.reply?.messageId);
    state.nextAt = this.now() + 3000;
    state.controller = new AbortController();
    const jobs = [];
    // Only an actual message read establishes processing. A queued draft is
    // replaced using the same draft ID; draft failures cannot suppress typing.
    if (!waiting && !uncertain && !slow) jobs.push(this.send('sendChatAction', { chat_id: message.chatId, action: 'typing' }, state));
    // Drafts expire automatically; no extra permanent acknowledgement messages.
    // Once useful content exists, keep it visible and use only typing status.
    if (!hasReply && (state.draftMessageId !== message.messageId || state.phase !== phase || state.draftAt <= this.now())) {
      const text = uncertain ? 'Reply delivery is unconfirmed. Awaiting review.'
        : slow ? 'This is taking longer than expected. Still waiting for a complete reply.'
        : waiting ? '⏳ Message delivered. Waiting for the ChatGPT scheduler to forward it to Dot.' : '';
      jobs.push(this.send('sendMessageDraft', { chat_id: message.chatId, draft_id: message.messageId, text }, state).then(sent => {
        if (sent) {
          state.phase = phase;
          state.draftMessageId = message.messageId;
          state.draftAt = this.now() + 20000;
        }
      }));
    }
    await Promise.all(jobs);
  }
  async beforeReply(chatId) {
    const state = this.state(chatId);
    state.hold += 1;
    state.controller?.abort();
    await state.job;
  }
  afterReply(chatId) {
    const state = this.state(chatId);
    state.hold -= 1;
    state.nextAt = 0;
    state.draftAt = 0;
    this.poke();
  }
  async close() {
    this.closed = true;
    for (const state of this.chats.values()) state.controller?.abort();
    await Promise.all([...this.chats.values()].map(state => state.job));
  }
}

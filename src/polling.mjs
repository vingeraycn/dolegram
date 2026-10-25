import { TelegramFailure } from './telegram.mjs';

export class PollingStopped extends Error {
  constructor(reason) { super(reason); }
}

// Outbound-only Telegram intake. No webhook changes or credential discovery.
export class TelegramPoller {
  constructor({ bridge, store, telegram, botId, username }) {
    this.bridge = bridge;
    this.store = store;
    this.telegram = telegram;
    this.botId = botId;
    this.username = username;
    this.key = `${bridge.config.ownerId}:${botId}`;
    this.busy = false;
    this.health = { state: 'starting', lastSuccessAt: null, retryAt: null, reason: null };
  }
  status() { return { ...this.health }; }
  async verify(signal) {
    const me = await this.telegram('getMe', {}, signal);
    if (String(me?.id) !== this.botId || me?.username !== this.username || me?.is_bot !== true) throw new PollingStopped('Bot identity mismatch');
    const webhook = await this.telegram('getWebhookInfo', {}, signal);
    if (!webhook || webhook.url !== '') throw new PollingStopped('Existing webhook; operator action required');
  }
  async once(signal) {
    if (signal?.aborted) return;
    if (this.busy) throw new PollingStopped('Concurrent polling refused');
    this.busy = true;
    try {
      await this.verify(signal);
      const offset = this.store.read().polling?.[this.key] ?? 0;
      const updates = await this.telegram('getUpdates', { offset, limit: 100, timeout: 25, allowed_updates: ['message'] }, signal);
      if (!Array.isArray(updates) || updates.length > 100 || updates.some(update => !Number.isSafeInteger(update?.update_id) || update.update_id < offset || update.update_id >= Number.MAX_SAFE_INTEGER)) throw new PollingStopped('Invalid polling response');
      updates.sort((a, b) => a.update_id - b.update_id);
      for (const update of updates) {
        if (signal?.aborted) return;
        // Acceptance commits deduplication and outbox before advancing the cursor.
        // A crash between commits safely replays the update through deduplication.
        this.bridge.acceptTelegramUpdate(update);
        this.store.mutate(state => {
          state.polling ??= {};
          state.polling[this.key] = Math.max(state.polling[this.key] ?? 0, update.update_id + 1);
        });
      }
    } finally { this.busy = false; }
  }
  async run(signal) {
    try {
      while (!signal.aborted) {
        try {
          this.health.state = 'polling';
          await this.once(signal);
          if (!signal.aborted) Object.assign(this.health, { lastSuccessAt: Date.now(), retryAt: null, reason: null });
        } catch (error) {
          if (signal.aborted) return;
          if (error instanceof PollingStopped || !(error instanceof TelegramFailure) || ['conflict', 'rejected'].includes(error.code)) {
            Object.assign(this.health, { state: 'stopped', retryAt: null,
              reason: error instanceof TelegramFailure && error.code === 'conflict' ? 'conflict' : 'verification_or_storage' });
            throw new PollingStopped('Polling stopped; inspect identity, webhook, credentials or competing consumer');
          }
          // Back off without retaining raw transport errors, credentials or messages.
          const delay = Math.max(1000, Math.min(2147483647, Number.isFinite(error.retryAfter) ? error.retryAfter * 1000 : 1000));
          Object.assign(this.health, { state: 'retrying', retryAt: Date.now() + delay,
            reason: error.code === 'rate_limit' ? 'rate_limit' : 'network' });
          await new Promise(resolve => {
            const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(undefined); };
            const timer = setTimeout(done, delay);
            signal.addEventListener('abort', done, { once: true });
            if (signal.aborted) done();
          });
        }
      }
    } finally {
      if (signal.aborted) Object.assign(this.health, { state: 'stopped', retryAt: null, reason: 'shutdown' });
    }
  }
}

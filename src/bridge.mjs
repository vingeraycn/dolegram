import { createHash, randomUUID } from 'node:crypto';
import { Webhook } from 'standardwebhooks';
import { callbackPost, equalSecret } from './security.mjs';
import { EVENT_NAME, event, tools, validate } from './contracts.mjs';
import { TelegramFailure } from './telegram.mjs';

export class RpcFailure extends Error {
  constructor(code, message, reason = undefined) { super(message); this.code = code; this.reason = reason; }
}
const invalid = () => { throw new RpcFailure(-32602, 'Invalid arguments'); };

export class Bridge {
  constructor({ store, config, telegram, post = callbackPost, now = Date.now }) {
    this.store = store;
    this.config = config;
    this.telegram = telegram;
    this.post = post;
    this.now = now;
  }
  allowed(chat) { return this.config.allowedChatIds.includes(chat); }
  principal(headers) {
    if (!equalSecret(headers.authorization, `Bearer ${this.config.mcpBearerToken}`)) throw new RpcFailure(-32001, 'Unauthorized');
    return this.config.ownerId;
  }
  async signedPost(subscription, value, id) {
    const body = JSON.stringify(value);
    if (Buffer.byteLength(body) > 262144) throw new Error('Event too large');
    const timestamp = new Date(this.now());
    const signatures = [new Webhook(subscription.secret).sign(id, timestamp, body)];
    if (subscription.previousSecret && subscription.rotationUntil > this.now()) {
      signatures.push(new Webhook(subscription.previousSecret).sign(id, timestamp, body));
    }
    return this.post(subscription.url, body, {
      'Content-Type': 'application/json', 'webhook-id': id,
      'webhook-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
      'webhook-signature': signatures.join(' '), 'X-MCP-Subscription-Id': subscription.id,
    });
  }
  async subscribe(params, owner) {
    if (params?.name !== EVENT_NAME || !validate(event.inputSchema, params.arguments) || !this.allowed(params.arguments.chat_id) || params.cursor != null) invalid();
    const delivery = params.delivery;
    if (delivery?.mode !== 'webhook' || typeof delivery.url !== 'string' || typeof delivery.secret !== 'string') invalid();
    const encoded = delivery.secret.slice(6);
    if (!delivery.secret.startsWith('whsec_') || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) invalid();
    const key = Buffer.from(encoded, 'base64');
    if (key.length < 24 || key.length > 64 || key.toString('base64') !== encoded) invalid();
    if (params.ttlMs !== undefined && params.ttlMs !== null && (!Number.isSafeInteger(params.ttlMs) || params.ttlMs <= 0)) invalid();
    const identity = JSON.stringify([owner, delivery.url, EVENT_NAME, params.arguments.chat_id]);
    const id = `sub_${createHash('sha256').update(identity).digest('hex')}`;
    const previous = this.store.read().subscriptions[id];
    const subscription = { id, owner, chatId: params.arguments.chat_id, url: delivery.url, secret: delivery.secret,
      expiresAt: this.now() + Math.min(params.ttlMs ?? 86400000, 86400000) };
    if (previous?.secret === subscription.secret && previous.rotationUntil > this.now()) {
      Object.assign(subscription, { previousSecret: previous.previousSecret, rotationUntil: previous.rotationUntil });
    }
    if (previous && previous.secret !== subscription.secret) {
      Object.assign(subscription, { previousSecret: previous.secret, rotationUntil: this.now() + 60000 });
    }
    const recentlyVerified = previous?.secret === subscription.secret && previous.verifiedAt > this.now() - 60000;
    if (!recentlyVerified) {
      const challenge = randomUUID();
      try {
        const response = await this.signedPost(subscription, { type: 'verification', challenge }, `verify_${randomUUID()}`);
        if (response.status < 200 || response.status >= 300 || !equalSecret(JSON.parse(response.body).challenge, challenge)) throw new Error('Verification failed');
      } catch { throw new RpcFailure(-32015, 'Callback verification failed', 'challenge_failed'); }
    }
    subscription['verifiedAt'] = recentlyVerified ? previous.verifiedAt : this.now();
    this.store.mutate(state => { state.subscriptions[id] = subscription; });
    return { id, refreshBefore: new Date(subscription.expiresAt).toISOString(), cursor: null, truncated: false };
  }
  async rpc(request, headers) {
    const owner = this.principal(headers);
    if (request?.jsonrpc !== '2.0' || !['string', 'number'].includes(typeof request.id) || typeof request.method !== 'string') throw new RpcFailure(-32600, 'Invalid request');
    const params = request.params;
    switch (request.method) {
      case 'server/discover': return { resultType: 'complete', supportedVersions: ['2026-07-28'], capabilities: { tools: {}, events: {} } };
      case 'tools/list': return { tools };
      case 'events/list': return { events: [event] };
      case 'events/subscribe': return this.subscribe(params, owner);
      case 'events/unsubscribe': {
        if (params?.name !== EVENT_NAME || !validate(event.inputSchema, params.arguments) || params.delivery?.mode !== 'webhook' || typeof params.delivery.url !== 'string') invalid();
        this.store.mutate(state => {
          for (const [id, sub] of Object.entries(state.subscriptions)) {
            if (sub.owner === owner && sub.chatId === params.arguments.chat_id && sub.url === params.delivery.url) delete state.subscriptions[id];
          }
        });
        return {};
      }
      case 'tools/call': {
        const tool = tools.find(item => item.name === params?.name);
        if (!tool || !validate(tool.inputSchema, params.arguments)) invalid();
        try {
          const result = await this.callTool(tool.name, params.arguments);
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (error) {
          const message = error instanceof RpcFailure ? error.message : 'Operation failed; inspect redacted status before retrying';
          return { isError: true, content: [{ type: 'text', text: message }] };
        }
      }
      default: throw new RpcFailure(-32601, 'Method not found');
    }
  }
  receive(update, secret) {
    if (this.config.telegramMode === 'polling' || !equalSecret(secret, this.config.telegramWebhookSecret)) throw new RpcFailure(-32001, 'Unauthorized');
    return this.acceptTelegramUpdate(update);
  }
  // Internal ingestion; external callers must use authenticated receive().
  acceptTelegramUpdate(update) {
    if (!Number.isSafeInteger(update?.update_id) || update.update_id < 0) invalid();
    const message = update.message;
    if (!message || message.chat?.type !== 'private' || message.from?.is_bot !== false || !Number.isSafeInteger(message.chat.id) || String(message.from.id) !== String(message.chat.id) || !this.allowed(String(message.chat.id))) return { ignored: true };
    if (!Number.isSafeInteger(message.message_id) || message.message_id <= 0 || typeof message.text !== 'string' || !message.text.trim() || message.text.length > 4096 || !Number.isSafeInteger(message.date)) return { ignored: true };
    const age = this.now() - message.date * 1000;
    if (age < -60000 || age > 86400000) return { ignored: true };
    const messageKey = `telegram_${update.update_id}`;
    return this.store.mutate(state => {
      if (state.messages[messageKey]) return { duplicate: true };
      state.messages[messageKey] = { owner: this.config.ownerId, messageKey, chatId: String(message.chat.id), messageId: message.message_id, text: message.text, reply: null };
      for (const sub of Object.values(state.subscriptions)) {
        if (sub.owner !== this.config.ownerId || sub.expiresAt <= this.now() || sub.chatId !== String(message.chat.id)) continue;
        const eventId = `evt_${update.update_id}_${sub.id}`;
        state.deliveries[eventId] = { subscriptionId: sub.id, attempts: 0, nextAt: this.now(),
          event: { eventId, name: EVENT_NAME, timestamp: new Date(message.date * 1000).toISOString(),
            data: { message_key: messageKey, chat_id: String(message.chat.id), text: message.text }, cursor: null } };
      }
      return { accepted: true };
    });
  }
  async deliver() {
    for (const [id, delivery] of Object.entries(this.store.read().deliveries)) {
      if (delivery.nextAt > this.now() || delivery.done) continue;
      const sub = this.store.read().subscriptions[delivery.subscriptionId];
      if (!sub || sub.owner !== this.config.ownerId || sub.expiresAt <= this.now() || !this.allowed(sub.chatId)) {
        this.store.mutate(state => { delete state.deliveries[id]; }); continue;
      }
      let status = 0;
      try { status = (await this.signedPost(sub, delivery.event, id)).status; } catch { /* Retry without retaining callback errors or URLs in logs. */ }
      this.store.mutate(state => {
        const item = state.deliveries[id];
        item.attempts += 1;
        item.done = (status >= 200 && status < 300) || [410, 413].includes(status) || (status >= 400 && status < 500 && ![408, 429].includes(status)) || item.attempts >= 6;
        item.nextAt = this.now() + Math.min(60000, 1000 * 2 ** item.attempts);
        if (status === 410) delete state.subscriptions[sub.id];
      });
    }
  }
  async callTool(name, args) {
    const state = this.store.read();
    if (name === 'get_bridge_status') return { source: 'reimplementation', messages: Object.values(state.messages).filter(message => message.owner === this.config.ownerId).length,
      subscriptions: Object.values(state.subscriptions).filter(sub => sub.expiresAt > this.now() && sub.owner === this.config.ownerId && this.allowed(sub.chatId)).length,
      uncertainReplies: Object.values(state.messages).filter(message => message.owner === this.config.ownerId && message.reply?.status === 'uncertain').length };
    const message = state.messages[args.message_key];
    if (!message || message.owner !== this.config.ownerId || !this.allowed(message.chatId)) throw new RpcFailure(-32602, 'Message unavailable');
    if (name === 'read_telegram_message') return { ...message, reply: message.reply && { revision: message.reply.revision, status: message.reply.status, final: message.reply.final } };
    const previous = message.reply;
    const retrySame = previous?.revision === args.revision && previous?.text === args.text && previous?.final === args.final;
    if (retrySame && previous.status === 'sent') return { message_id: previous.messageId, revision: previous.revision, final: previous.final };
    if (previous?.status === 'pending' || previous?.status === 'uncertain') throw new RpcFailure(-32602, 'Reply outcome uncertain; do not resend automatically');
    if (!args.text.trim()) invalid();
    if (name === 'reply_telegram_message' && (previous || args.revision !== 1)) throw new RpcFailure(-32602, 'Reply already exists');
    if (name === 'update_telegram_message') {
      if (!previous || previous.final || args.revision !== previous.revision + 1 || !args.text.startsWith(previous.text) || args.text.length <= previous.text.length || (args.final && args.revision < 3) || (!args.final && args.revision === 4)) throw new RpcFailure(-32602, 'Invalid cumulative revision');
    }
    if (message.retryAt > this.now()) throw new RpcFailure(-32602, 'Rate limited; wait before retrying');
    const pending = { revision: args.revision, text: args.text, final: args.final, messageId: previous?.messageId, status: 'pending' };
    // Persist intent before the external write. A crash leaves a blocked, uncertain operation.
    this.store.mutate(current => { current.messages[args.message_key].reply = pending; });
    try {
      const params = { chat_id: message.chatId, text: args.text };
      const method = previous ? 'editMessageText' : 'sendMessage';
      if (previous) params['message_id'] = previous.messageId;
      else params['reply_parameters'] = { message_id: message.messageId };
      const result = await this.telegram(method, params);
      const messageId = result?.message_id ?? previous?.messageId;
      if (!Number.isSafeInteger(messageId)) throw new TelegramFailure('uncertain');
      this.store.mutate(current => { current.messages[args.message_key].reply = { ...pending, messageId, status: 'sent' }; });
      return { message_id: messageId, revision: args.revision, final: args.final };
    } catch (error) {
      const safeRetry = error instanceof TelegramFailure && ['rate_limit', 'rejected'].includes(error.code);
      this.store.mutate(current => {
        current.messages[args.message_key].reply = safeRetry ? previous : { ...pending, status: 'uncertain' };
        if (safeRetry) current.messages[args.message_key].retryAt = this.now() + (error.retryAfter || 1) * 1000;
      });
      throw new RpcFailure(-32603, safeRetry ? 'Telegram rejected the write; retry only after any rate limit' : 'Reply outcome uncertain; do not resend automatically');
    }
  }
}

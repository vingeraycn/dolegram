import { event, EVENT_NAME, objectSchema, tools, validate } from '../contracts.mjs';
import { TelegramFailure } from '../telegram.mjs';
import { CallbackPolicyError, subscriptionId } from './callbacks.mjs';

export const sitesTools = [...tools, {
  name: 'flush_event_deliveries',
  description: 'Retry due persisted MCP Events for this owner. For an explicitly approved Sites scheduled task; no timer or waitUntil durability is assumed.',
  inputSchema: objectSchema({}),
}];

export class SitesProtocolError extends Error {
  constructor(code, message, reason = undefined) { super(message); this.code = code; this.reason = reason; }
}
const invalid = () => { throw new SitesProtocolError(-32602, 'Invalid arguments'); };

export class SitesBridge {
  constructor({ store, allowedChatIds, telegram, callbacks, now = Date.now }) {
    this.store = store;
    this.allowedChatIds = allowedChatIds;
    this.telegram = telegram;
    this.callbacks = callbacks;
    this.now = now;
  }
  async subscribe(params) {
    if (params?.name !== EVENT_NAME || !validate(event.inputSchema, params.arguments) || !this.allowedChatIds.includes(params.arguments.chat_id) || params.cursor != null) invalid();
    const delivery = params.delivery;
    if (delivery?.mode !== 'webhook' || typeof delivery.url !== 'string' || typeof delivery.secret !== 'string') invalid();
    const encoded = delivery.secret.slice(6);
    const decoded = Buffer.from(encoded, 'base64');
    if (!delivery.secret.startsWith('whsec_') || decoded.length < 24 || decoded.length > 64 || decoded.toString('base64') !== encoded) invalid();
    if (params.ttlMs != null && (!Number.isSafeInteger(params.ttlMs) || params.ttlMs <= 0)) invalid();
    const id = subscriptionId(this.store.owner, delivery.url, params.arguments.chat_id);
    const previous = await this.store.subscription(id);
    const sub = { id, chat_id: params.arguments.chat_id, url: delivery.url, secret: delivery.secret,
      verified_at: this.now(), expires_at: this.now() + Math.min(params.ttlMs ?? 86400000, 86400000) };
    if (previous?.secret === sub.secret && previous.rotation_until > this.now()) {
      Object.assign(sub, { previous_secret: previous.previous_secret, rotation_until: previous.rotation_until });
    }
    if (previous && previous.secret !== sub.secret) Object.assign(sub, { previous_secret: previous.secret, rotation_until: this.now() + 60000 });
    try {
      // Revalidate fixed-origin policy even when a recent challenge is cached.
      if (!this.callbacks.ready) throw new CallbackPolicyError('callback_transport_unverified');
      this.callbacks.validate(sub.url);
      if (!(previous?.secret === sub.secret && previous.verified_at > this.now() - 60000)) await this.callbacks.verify(sub);
      else sub.verified_at = previous.verified_at;
    } catch (error) {
      throw new SitesProtocolError(-32015, 'Callback verification unavailable or failed', error instanceof CallbackPolicyError ? error.reason : 'challenge_failed');
    }
    await this.store.saveSubscription(sub);
    return { id, refreshBefore: new Date(sub.expires_at).toISOString(), cursor: null, truncated: false };
  }
  async receive(update) {
    const message = update?.message;
    if (!Number.isSafeInteger(update?.update_id) || update.update_id < 0) invalid();
    if (!message || message.chat?.type !== 'private' || message.from?.is_bot !== false || !Number.isSafeInteger(message.chat.id) || String(message.from.id) !== String(message.chat.id) || !this.allowedChatIds.includes(String(message.chat.id))) return { ignored: true };
    if (!Number.isSafeInteger(message.message_id) || message.message_id <= 0 || typeof message.text !== 'string' || !message.text.trim() || message.text.length > 4096 || !Number.isSafeInteger(message.date)) return { ignored: true };
    const age = this.now() - message.date * 1000;
    if (age < -60000 || age > 86400000) return { ignored: true };
    const accepted = await this.store.receive({ message_key: `telegram_${update.update_id}`, chat_id: String(message.chat.id), message_id: message.message_id, text: message.text }, new Date(message.date * 1000).toISOString(), this.now());
    return accepted ? { accepted: true } : { duplicate: true };
  }
  async flush() {
    if (!this.callbacks.ready) throw new SitesProtocolError(-32015, 'Callback transport not verified');
    let attempted = 0;
    for (const { id } of await this.store.due(this.now())) {
      const item = await this.store.claimDelivery(id, this.now());
      if (!item) continue;
      const sub = await this.store.subscription(item.subscription_id);
      if (!sub || sub.expires_at <= this.now() || !this.allowedChatIds.includes(sub.chat_id)) {
        await this.store.finishDelivery(item, 410, this.now(), sub); continue;
      }
      let status = 0;
      try { status = (await this.callbacks.send(sub, item.body, item.id)).status; } catch { /* Persist retry state without raw transport errors. */ }
      await this.store.finishDelivery(item, status, this.now(), sub);
      attempted++;
    }
    return { attempted, ...(await this.store.counts()) };
  }
  async callTool(name, args) {
    if (name === 'get_bridge_status') return { source: 'sites-reimplementation', callbackReady: this.callbacks.ready, ...(await this.store.counts()) };
    if (name === 'flush_event_deliveries') return this.flush();
    const message = await this.store.message(args.message_key);
    if (!message || !this.allowedChatIds.includes(message.chat_id)) throw new SitesProtocolError(-32602, 'Message unavailable');
    if (name === 'read_telegram_message') return { message_key: message.message_key, chat_id: message.chat_id, text: message.text, revision: message.revision, final: Boolean(message.final), reply_status: message.reply_status };
    if (message.reply_status === 'sent' && message.revision === args.revision && message.reply_text === args.text && Boolean(message.final) === args.final) {
      return { message_id: message.reply_id, revision: message.revision, final: Boolean(message.final) };
    }
    if (!args.text.trim()) invalid();
    if (name === 'reply_telegram_message' && message.revision !== 0) invalid();
    if (name === 'update_telegram_message' && (message.revision === 0 || message.final || args.revision !== message.revision + 1 || !args.text.startsWith(message.reply_text) || args.text.length <= message.reply_text.length || (args.final && args.revision < 3) || (!args.final && args.revision === 4))) invalid();
    const claimed = await this.store.claimReply(args.message_key, message.revision, this.now());
    if (!claimed) throw new SitesProtocolError(-32602, 'Reply busy, uncertain, rate limited or revision changed; inspect status before retrying');
    try {
      const params = { chat_id: message.chat_id, text: args.text };
      if (message.revision === 0) params['reply_parameters'] = { message_id: message.message_id };
      else params['message_id'] = message.reply_id;
      const response = await this.telegram(message.revision === 0 ? 'sendMessage' : 'editMessageText', params);
      const replyId = response?.message_id ?? message.reply_id;
      if (!Number.isSafeInteger(replyId)) throw new TelegramFailure('uncertain');
      await this.store.finishReply(args.message_key, claimed.claim, args.text, args.revision, args.final, replyId);
      return { message_id: replyId, revision: args.revision, final: args.final };
    } catch (error) {
      const safeRetry = error instanceof TelegramFailure && ['rejected', 'rate_limit'].includes(error.code);
      await this.store.failReply(args.message_key, claimed.claim, safeRetry, this.now() + (safeRetry ? (error.retryAfter || 1) * 1000 : 0));
      throw new SitesProtocolError(-32603, safeRetry ? 'Telegram rejected the request; respect any retry deadline' : 'Reply outcome uncertain; operator reconciliation required');
    }
  }
  async rpc(request) {
    if (request?.jsonrpc !== '2.0' || !['string', 'number'].includes(typeof request.id) || typeof request.method !== 'string') throw new SitesProtocolError(-32600, 'Invalid request');
    const params = request.params;
    switch (request.method) {
      case 'server/discover': return { resultType: 'complete', supportedVersions: ['2026-07-28'], capabilities: { tools: {}, events: {} } };
      case 'events/list': return { events: [event] };
      case 'tools/list': return { tools: sitesTools };
      case 'events/subscribe': return this.subscribe(params);
      case 'events/unsubscribe':
        if (params?.name !== EVENT_NAME || !validate(event.inputSchema, params.arguments) || params.delivery?.mode !== 'webhook' || typeof params.delivery.url !== 'string') invalid();
        await this.store.unsubscribe(subscriptionId(this.store.owner, params.delivery.url, params.arguments.chat_id));
        return {};
      case 'tools/call': {
        const tool = sitesTools.find(item => item.name === params?.name);
        if (!tool || !validate(tool.inputSchema, params.arguments)) invalid();
        try { return { content: [{ type: 'text', text: JSON.stringify(await this.callTool(tool.name, params.arguments)) }] }; }
        catch (error) { return { isError: true, content: [{ type: 'text', text: error instanceof SitesProtocolError ? error.message : 'Operation failed; inspect status before retrying' }] }; }
      }
      default: throw new SitesProtocolError(-32601, 'Method not found');
    }
  }
}

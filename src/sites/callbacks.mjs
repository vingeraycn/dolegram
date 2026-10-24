import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { Webhook } from 'standardwebhooks';
import { EVENT_NAME } from '../contracts.mjs';

export function secretEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export class CallbackPolicyError extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}

export function exactOriginPolicy(origins) {
  const allowed = new Set(origins);
  for (const origin of allowed) {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'https:' || parsed.origin !== origin || parsed.port || parsed.username || parsed.password || !parsed.hostname.includes('.') || /^[0-9.]+$/.test(parsed.hostname) || parsed.hostname.includes(':') || !parsed.hostname.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
      throw new CallbackPolicyError('invalid_trusted_origin');
    }
  }
  return destination => {
    const url = new URL(destination);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port || !allowed.has(url.origin)) {
      throw new CallbackPolicyError('untrusted_callback_origin');
    }
    return url;
  };
}

export function subscriptionId(owner, url, chatId) {
  return `sub_${createHash('sha256').update(JSON.stringify([owner, url, EVENT_NAME, chatId])).digest('hex')}`;
}

// A fixed origin is defense in depth, not a waiver of the documented egress policy.
export class SignedCallbacks {
  constructor({ origins = [], post = null, now = Date.now } = {}) {
    this.validate = exactOriginPolicy(origins);
    this.post = post;
    this.ready = origins.length > 0 && typeof post === 'function';
    this.now = now;
  }
  async send(subscription, body, id) {
    if (!this.ready) throw new CallbackPolicyError('callback_transport_unverified');
    this.validate(subscription.url);
    if (Buffer.byteLength(body) > 262144) throw new CallbackPolicyError('event_too_large');
    const date = new Date(this.now());
    const signatures = [new Webhook(subscription.secret).sign(id, date, body)];
    if (subscription.previous_secret && subscription.rotation_until > this.now()) {
      signatures.push(new Webhook(subscription.previous_secret).sign(id, date, body));
    }
    const response = await this.post(subscription.url, body, {
      'Content-Type': 'application/json', 'webhook-id': id,
      'webhook-timestamp': String(Math.floor(date.getTime() / 1000)),
      'webhook-signature': signatures.join(' '), 'X-MCP-Subscription-Id': subscription.id,
    });
    if (response.status >= 300 && response.status < 400) throw new CallbackPolicyError('redirect_rejected');
    return response;
  }
  async verify(subscription) {
    const challenge = randomUUID();
    const response = await this.send(subscription, JSON.stringify({ type: 'verification', challenge }), `verify_${randomUUID()}`);
    if (response.status < 200 || response.status >= 300 || !secretEqual(JSON.parse(response.body).challenge, challenge)) throw new CallbackPolicyError('challenge_failed');
  }
}

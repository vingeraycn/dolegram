import { randomUUID } from 'node:crypto';
import { EVENT_NAME } from '../contracts.mjs';

export class SitesStore {
  constructor(db, owner) { this.db = db; this.owner = owner; }
  statement(sql, ...values) { return this.db.prepare(sql).bind(...values); }
  async subscription(id) { return this.statement('SELECT * FROM dotg_subscriptions WHERE owner=? AND id=?', this.owner, id).first(); }
  async saveSubscription(sub) {
    await this.statement(`INSERT INTO dotg_subscriptions (owner,id,chat_id,url,secret,previous_secret,rotation_until,verified_at,expires_at)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET secret=excluded.secret,previous_secret=excluded.previous_secret,
      rotation_until=excluded.rotation_until,verified_at=excluded.verified_at,expires_at=excluded.expires_at`,
    this.owner, sub.id, sub.chat_id, sub.url, sub.secret, sub.previous_secret ?? null, sub.rotation_until ?? 0, sub.verified_at, sub.expires_at).run();
  }
  async unsubscribe(id) {
    await this.db.batch([
      this.statement('DELETE FROM dotg_subscriptions WHERE owner=? AND id=?', this.owner, id),
      this.statement('DELETE FROM dotg_outbox WHERE owner=? AND subscription_id=?', this.owner, id),
    ]);
  }
  async receive(message, timestamp, now) {
    const nonce = randomUUID();
    const results = await this.db.batch([
      this.statement('INSERT OR IGNORE INTO dotg_messages (owner,message_key,ingest_nonce,chat_id,message_id,text) VALUES (?,?,?,?,?,?)',
        this.owner, message.message_key, nonce, message.chat_id, message.message_id, message.text),
      this.statement(`INSERT OR IGNORE INTO dotg_outbox (owner,id,subscription_id,body,next_at)
        SELECT s.owner, 'evt_' || ? || '_' || s.id, s.id,
          json_object('eventId','evt_' || ? || '_' || s.id,'name',?,'timestamp',?,
            'data',json_object('message_key',m.message_key,'chat_id',m.chat_id,'text',m.text),'cursor',NULL), ?
        FROM dotg_subscriptions s JOIN dotg_messages m ON m.owner=s.owner AND m.chat_id=s.chat_id
        WHERE m.owner=? AND m.message_key=? AND m.ingest_nonce=? AND s.expires_at>?`,
      message.message_key, message.message_key, EVENT_NAME, timestamp, now, this.owner, message.message_key, nonce, now),
    ]);
    return results[0].meta.changes === 1;
  }
  async message(key) { return this.statement('SELECT * FROM dotg_messages WHERE owner=? AND message_key=?', this.owner, key).first(); }
  async claimReply(key, revision, now) {
    const claim = randomUUID();
    const results = await this.db.batch([
      this.statement(`UPDATE dotg_messages SET claim=?, reply_status='pending'
        WHERE owner=? AND message_key=? AND revision=? AND final=0 AND retry_at<=? AND reply_status IN ('idle','sent')`,
      claim, this.owner, key, revision, now),
      this.statement('SELECT * FROM dotg_messages WHERE owner=? AND message_key=? AND claim=?', this.owner, key, claim),
    ]);
    return results[0].meta.changes === 1 ? results[1].results[0] : null;
  }
  async finishReply(key, claim, text, revision, final, messageId) {
    await this.statement(`UPDATE dotg_messages SET reply_text=?,revision=?,final=?,reply_id=?,reply_status='sent',claim=NULL,retry_at=0
      WHERE owner=? AND message_key=? AND claim=?`, text, revision, Number(final), messageId, this.owner, key, claim).run();
  }
  async failReply(key, claim, safeRetry, retryAt) {
    await this.statement(`UPDATE dotg_messages SET reply_status=CASE WHEN ? THEN CASE WHEN revision=0 THEN 'idle' ELSE 'sent' END ELSE 'uncertain' END,
      claim=NULL,retry_at=? WHERE owner=? AND message_key=? AND claim=?`, Number(safeRetry), retryAt, this.owner, key, claim).run();
  }
  async due(now) {
    return (await this.statement(`SELECT id FROM dotg_outbox WHERE owner=? AND done=0 AND attempts<6 AND next_at<=? AND lease_until<=? ORDER BY next_at LIMIT 20`, this.owner, now, now).all()).results;
  }
  async claimDelivery(id, now) {
    const claim = randomUUID();
    const result = await this.db.batch([
      this.statement(`UPDATE dotg_outbox SET claim=?,lease_until=?,attempts=attempts+1
        WHERE owner=? AND id=? AND done=0 AND attempts<6 AND next_at<=? AND lease_until<=?`, claim, now + 15000, this.owner, id, now, now),
      this.statement('SELECT * FROM dotg_outbox WHERE owner=? AND id=? AND claim=?', this.owner, id, claim),
    ]);
    return result[0].meta.changes === 1 ? result[1].results[0] : null;
  }
  async finishDelivery(item, status, now, subscription = null) {
    const terminal = (status >= 200 && status < 300) || [410, 413].includes(status) || (status >= 400 && status < 500 && ![408, 429].includes(status)) || item.attempts >= 6;
    const operations = [this.statement('UPDATE dotg_outbox SET done=?,next_at=?,lease_until=0,claim=NULL WHERE owner=? AND id=? AND claim=?',
      Number(terminal), now + Math.min(60000, 1000 * 2 ** item.attempts), this.owner, item.id, item.claim)];
    if (status === 410 && subscription) operations.push(this.statement('DELETE FROM dotg_subscriptions WHERE owner=? AND id=? AND secret=? AND verified_at=? AND expires_at=?', this.owner, item.subscription_id, subscription.secret, subscription.verified_at, subscription.expires_at));
    await this.db.batch(operations);
  }
  async counts() {
    const result = await this.db.batch([
      this.statement('SELECT count(*) AS count FROM dotg_messages WHERE owner=?', this.owner),
      this.statement('SELECT count(*) AS count FROM dotg_outbox WHERE owner=? AND done=0 AND attempts<6', this.owner),
      this.statement("SELECT count(*) AS count FROM dotg_messages WHERE owner=? AND reply_status IN ('pending','uncertain')", this.owner),
    ]);
    return { messages: result[0].results[0].count, pendingEvents: result[1].results[0].count, uncertainReplies: result[2].results[0].count };
  }
}

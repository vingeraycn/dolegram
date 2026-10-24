import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

export class Store {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=DELETE;
      CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK (id=1), value TEXT NOT NULL);`);
    this.db.prepare('INSERT OR IGNORE INTO state VALUES (1, ?)').run(JSON.stringify({ messages: {}, subscriptions: {}, deliveries: {} }));
    this.mutate(state => {
      for (const message of Object.values(state.messages)) {
        if (message.reply?.status === 'pending') message.reply.status = 'uncertain';
      }
    });
  }
  read() {
    const row = this.db.prepare('SELECT value FROM state WHERE id=1').get();
    if (!row || typeof row !== 'object' || !('value' in row) || typeof row.value !== 'string') throw new Error('Invalid stored state');
    return JSON.parse(row.value);
  }
  mutate(change) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const state = this.read();
      const result = change(state);
      this.db.prepare('UPDATE state SET value=? WHERE id=1').run(JSON.stringify(state));
      this.db.exec('COMMIT');
      return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); }
}

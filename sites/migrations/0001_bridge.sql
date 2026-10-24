CREATE TABLE dotg_messages (
  owner TEXT NOT NULL,
  message_key TEXT NOT NULL,
  ingest_nonce TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  reply_id INTEGER,
  reply_text TEXT,
  final INTEGER NOT NULL DEFAULT 0,
  reply_status TEXT NOT NULL DEFAULT 'idle',
  claim TEXT,
  retry_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner, message_key)
);

CREATE TABLE dotg_subscriptions (
  owner TEXT NOT NULL,
  id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  previous_secret TEXT,
  rotation_until INTEGER NOT NULL DEFAULT 0,
  verified_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (owner, id)
);

CREATE TABLE dotg_outbox (
  owner TEXT NOT NULL,
  id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  body TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL,
  lease_until INTEGER NOT NULL DEFAULT 0,
  claim TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner, id)
);

CREATE INDEX dotg_outbox_due ON dotg_outbox (owner, done, next_at);

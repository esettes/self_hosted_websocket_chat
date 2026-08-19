-- SQLite schema (future use)

CREATE TABLE IF NOT EXISTS chats (
  token TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  owner_key TEXT,
  passcode TEXT,
  name TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_token TEXT NOT NULL,
  author TEXT,
  user_id TEXT,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (chat_token) REFERENCES chats (token)
);

CREATE INDEX IF NOT EXISTS idx_messages_chat
  ON messages (chat_token, created_at);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  steps TEXT,
  description TEXT NOT NULL,
  page TEXT,
  chat_token TEXT,
  fingerprint TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reports_created
  ON reports (created_at);

CREATE INDEX IF NOT EXISTS idx_reports_fingerprint
  ON reports (fingerprint, created_at);

CREATE TABLE IF NOT EXISTS creators (
  id TEXT PRIMARY KEY,
  tier TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_creators_tier
  ON creators (tier, created_at);

CREATE TABLE IF NOT EXISTS chat_creations (
  id TEXT PRIMARY KEY,
  creator_id TEXT,
  fingerprint TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (creator_id) REFERENCES creators (id)
);

CREATE INDEX IF NOT EXISTS idx_chat_creations_creator
  ON chat_creations (creator_id, created_at);

CREATE INDEX IF NOT EXISTS idx_chat_creations_fingerprint
  ON chat_creations (fingerprint, created_at);

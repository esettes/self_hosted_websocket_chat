import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

import { createId, createPasscode, createToken } from '../utils/tokens.js';

const MAX_MESSAGES = 200;
const CHAT_TTL_MS = 24 * 60 * 60 * 1000;

export function initSqliteStore(dbPath) {
  if (!dbPath) {
    throw new Error('dbPath is required');
  }

  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
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

  `);

  try {
    db.exec('ALTER TABLE chats ADD COLUMN owner_key TEXT');
  } catch {
    // Column already exists.
  }
  try {
    db.exec('ALTER TABLE chats ADD COLUMN passcode TEXT');
  } catch {
    // Column already exists.
  }
  try {
    db.exec('ALTER TABLE chats ADD COLUMN name TEXT');
  } catch {
    // Column already exists.
  }
  try {
    db.exec('ALTER TABLE messages ADD COLUMN user_id TEXT');
  } catch {
    // Column already exists.
  }
  try {
    db.exec('ALTER TABLE reports ADD COLUMN fingerprint TEXT');
  } catch {
    // Column already exists.
  }
  try {
    db.exec('ALTER TABLE chat_creations ADD COLUMN fingerprint TEXT');
  } catch {
    // Column already exists.
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_reports_fingerprint
      ON reports (fingerprint, created_at);

    CREATE INDEX IF NOT EXISTS idx_chat_creations_fingerprint
      ON chat_creations (fingerprint, created_at);
  `);

  const insertChat = db.prepare(
    'INSERT INTO chats (token, created_at, owner_key, passcode, name) VALUES (?, ?, ?, ?, ?)'
  );
  const listChatsStmt = db.prepare(
    'SELECT token, created_at as createdAt, name FROM chats ORDER BY created_at ASC'
  );
  const getChatStmt = db.prepare(
    'SELECT token, created_at as createdAt, name FROM chats WHERE token = ?'
  );
  const getOwnerStmt = db.prepare(
    'SELECT owner_key as ownerKey FROM chats WHERE token = ?'
  );
  const getPasscodeStmt = db.prepare(
    'SELECT passcode FROM chats WHERE token = ?'
  );
  const insertMessage = db.prepare(
    `INSERT INTO messages
      (id, chat_token, author, user_id, text, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insertReport = db.prepare(
    `INSERT INTO reports
      (id, type, steps, description, page, chat_token, fingerprint, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const getCreatorStmt = db.prepare(
    'SELECT id, tier, created_at as createdAt FROM creators WHERE id = ?'
  );
  const countSeedCreatorsStmt = db.prepare(
    "SELECT COUNT(*) as count FROM creators WHERE tier = 'seed'"
  );
  const insertCreatorStmt = db.prepare(
    'INSERT INTO creators (id, tier, created_at) VALUES (?, ?, ?)'
  );
  const insertChatCreationStmt = db.prepare(
    'INSERT INTO chat_creations (id, creator_id, fingerprint, created_at) VALUES (?, ?, ?, ?)'
  );
  const recentChatCreationByCreatorStmt = db.prepare(
    `SELECT 1 FROM chat_creations
      WHERE creator_id = ? AND created_at >= ?
      LIMIT 1`
  );
  const countRecentChatCreationsByFingerprintStmt = db.prepare(
    `SELECT COUNT(*) as count FROM chat_creations
      WHERE fingerprint = ? AND created_at >= ?`
  );
  const listReportsStmt = db.prepare(
    `SELECT id,
      type,
      steps,
      description,
      page,
      chat_token as chatToken,
      fingerprint,
      created_at as createdAt
    FROM reports
    ORDER BY created_at DESC`
  );
  const recentReportStmt = db.prepare(
    `SELECT 1 FROM reports
      WHERE fingerprint = ? AND type IN ('bug', 'improvement') AND created_at >= ?
      LIMIT 1`
  );
  const listMessagesStmt = db.prepare(
    `SELECT id,
      chat_token as chatToken,
      author,
      user_id as userId,
      text,
      created_at as createdAt
    FROM messages
    WHERE chat_token = ?
    ORDER BY created_at DESC
    LIMIT ?`
  );
  const deleteMessagesStmt = db.prepare(
    'DELETE FROM messages WHERE chat_token = ?'
  );
  const deleteChatStmt = db.prepare(
    'DELETE FROM chats WHERE token = ?'
  );
  const deleteMessagesByCutoffStmt = db.prepare(
    'DELETE FROM messages WHERE chat_token IN (SELECT token FROM chats WHERE created_at < ?)'
  );
  const deleteChatsByCutoffStmt = db.prepare(
    'DELETE FROM chats WHERE created_at < ?'
  );
  const claimOwnerStmt = db.prepare(
    'UPDATE chats SET owner_key = ? WHERE token = ? AND owner_key IS NULL'
  );
  const deleteChatTx = db.transaction((token) => {
    deleteMessagesStmt.run(token);
    return deleteChatStmt.run(token).changes > 0;
  });
  const cleanupExpiredTx = db.transaction((cutoff) => {
    deleteMessagesByCutoffStmt.run(cutoff);
    deleteChatsByCutoffStmt.run(cutoff);
  });
  const ensureCreatorTx = db.transaction((id, seedLimit) => {
    const existing = getCreatorStmt.get(id);
    if (existing) return existing;
    const seedCount = countSeedCreatorsStmt.get().count;
    const tier = seedCount < seedLimit ? 'seed' : 'standard';
    const createdAt = new Date().toISOString();
    insertCreatorStmt.run(id, tier, createdAt);
    return { id, tier, createdAt };
  });

  function createChat(options = {}) {
    const requirePasscode = options.requirePasscode !== false;
    const name =
      typeof options.name === 'string' && options.name.trim()
        ? options.name.trim()
        : null;
    while (true) {
      const token = createToken();
      const ownerKey = createToken(16);
      const passcode = requirePasscode ? createPasscode(5) : null;
      const createdAt = new Date().toISOString();
      try {
        insertChat.run(token, createdAt, ownerKey, passcode, name);
        return { token, createdAt, ownerKey, passcode, name };
      } catch (err) {
        if (err && String(err.code).startsWith('SQLITE_CONSTRAINT')) {
          continue;
        }
        throw err;
      }
    }
  }

  function listChats() {
    return listChatsStmt.all().filter((chat) => !isExpired(chat.createdAt));
  }

  function getChat(token) {
    const chat = getChatStmt.get(token);
    if (!chat) return null;
    if (isExpired(chat.createdAt)) return null;
    return chat;
  }

  function isOwner(token, ownerKey) {
    if (!ownerKey) return false;
    const chat = getChat(token);
    if (!chat) return false;
    const row = getOwnerStmt.get(token);
    if (!row) return false;
    return row.ownerKey === ownerKey;
  }

  function revealPasscode(token, ownerKey) {
    if (!ownerKey) return null;
    const chat = getChat(token);
    if (!chat) return null;
    const row = getOwnerStmt.get(token);
    if (!row || row.ownerKey !== ownerKey) return null;
    const passcodeRow = getPasscodeStmt.get(token);
    return passcodeRow ? passcodeRow.passcode : null;
  }

  function verifyPasscode(token, passcode) {
    const chat = getChat(token);
    if (!chat) return false;
    const row = getPasscodeStmt.get(token);
    if (!row) return false;
    if (!row.passcode) return true;
    const normalized = normalizePasscode(passcode);
    return normalized === row.passcode;
  }

  function claimOwner(token) {
    const chat = getChat(token);
    if (!chat) return null;
    const ownerKey = createToken(16);
    const result = claimOwnerStmt.run(ownerKey, token);
    if (result.changes === 0) return null;
    return ownerKey;
  }

  function addMessage(chatToken, message) {
    try {
      const result = insertMessage.run(
        message.id || createId(),
        chatToken,
        message.author || null,
        message.userId || null,
        message.text,
        message.createdAt || new Date().toISOString()
      );
      return result.changes > 0;
    } catch (err) {
      if (err && err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
        return false;
      }
      throw err;
    }
  }

  function listMessages(chatToken) {
    const rows = listMessagesStmt.all(chatToken, MAX_MESSAGES);
    return rows.reverse();
  }

  function addReport(payload) {
    const report = {
      id: createId(),
      type: payload.type,
      steps: payload.steps || null,
      description: payload.description,
      page: payload.page || null,
      chatToken: payload.chatToken || null,
      fingerprint: payload.fingerprint || '',
      createdAt: new Date().toISOString(),
    };
    insertReport.run(
      report.id,
      report.type,
      report.steps,
      report.description,
      report.page,
      report.chatToken,
      report.fingerprint,
      report.createdAt
    );
    return report;
  }

  function hasRecentReport({ fingerprint, cutoff }) {
    const row = recentReportStmt.get(fingerprint || '', cutoff);
    return Boolean(row);
  }

  function listReports() {
    return listReportsStmt.all();
  }

  function ensureCreator(id, seedLimit) {
    return ensureCreatorTx(id, seedLimit);
  }

  function addChatCreation({ creatorId, fingerprint }) {
    const createdAt = new Date().toISOString();
    insertChatCreationStmt.run(
      createId(),
      creatorId || null,
      fingerprint || '',
      createdAt
    );
    return true;
  }

  function hasRecentChatCreation({ creatorId, cutoff }) {
    const row = recentChatCreationByCreatorStmt.get(creatorId || '', cutoff);
    return Boolean(row);
  }

  function countRecentChatCreationsByFingerprint({ fingerprint, cutoff }) {
    const row = countRecentChatCreationsByFingerprintStmt.get(
      fingerprint || '',
      cutoff
    );
    return row ? row.count : 0;
  }

  function cleanupExpired() {
    const cutoff = new Date(Date.now() - CHAT_TTL_MS).toISOString();
    cleanupExpiredTx(cutoff);
  }

  return {
    createChat,
    listChats,
    getChat,
    isOwner,
    revealPasscode,
    verifyPasscode,
    claimOwner,
    addMessage,
    listMessages,
    addReport,
    hasRecentReport,
    listReports,
    ensureCreator,
    addChatCreation,
    hasRecentChatCreation,
    countRecentChatCreationsByFingerprint,
    deleteChat: deleteChatTx,
    cleanupExpired,
  };
}

function normalizePasscode(passcode) {
  return String(passcode || '').trim().toUpperCase();
}

function isExpired(createdAt) {
  return Date.now() - new Date(createdAt).getTime() > CHAT_TTL_MS;
}

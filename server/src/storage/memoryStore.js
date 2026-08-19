import { createId, createPasscode, createToken } from '../utils/tokens.js';

const chats = new Map();
const messages = new Map();
const reports = [];
const creators = new Map();
const chatCreations = [];
let seedCreatorCount = 0;
const CHAT_TTL_MS = 24 * 60 * 60 * 1000;

export function createChat(options = {}) {
  let token = createToken();
  while (chats.has(token)) {
    token = createToken();
  }

  const requirePasscode = options.requirePasscode !== false;
  const ownerKey = createToken(16);
  const passcode = requirePasscode ? createPasscode(5) : null;
  const name =
    typeof options.name === 'string' && options.name.trim()
      ? options.name.trim()
      : null;
  const chat = {
    token,
    createdAt: new Date().toISOString(),
    ownerKey,
    passcode,
    name,
  };

  chats.set(token, chat);
  messages.set(token, []);

  return chat;
}

export function listChats() {
  cleanupExpired();
  return Array.from(chats.values())
    .map(({ token, createdAt, name }) => ({ token, createdAt, name }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getChat(token) {
  const chat = getChatInternal(token);
  if (!chat) return null;
  return { token: chat.token, createdAt: chat.createdAt, name: chat.name };
}

export function addMessage(chatToken, message) {
  const list = messages.get(chatToken);
  if (!list) return false;
  list.push(message);
  return true;
}

export function listMessages(chatToken) {
  const list = messages.get(chatToken);
  return list ? list.slice(-200) : [];
}

export function isOwner(token, ownerKey) {
  const chat = getChatInternal(token);
  if (!chat || !ownerKey) return false;
  return chat.ownerKey === ownerKey;
}

export function revealPasscode(token, ownerKey) {
  const chat = getChatInternal(token);
  if (!chat || !ownerKey) return null;
  if (chat.ownerKey !== ownerKey) return null;
  return chat.passcode || null;
}

export function verifyPasscode(token, passcode) {
  const chat = getChatInternal(token);
  if (!chat) return false;
  if (!chat.passcode) return true;
  const normalized = normalizePasscode(passcode);
  return normalized === chat.passcode;
}

export function claimOwner(token) {
  const chat = getChatInternal(token);
  if (!chat || chat.ownerKey) return null;
  const ownerKey = createToken(16);
  chat.ownerKey = ownerKey;
  return ownerKey;
}

export function deleteChat(token) {
  const existed = chats.delete(token);
  messages.delete(token);
  return existed;
}

export function cleanupExpired() {
  const now = Date.now();
  for (const [token, chat] of chats.entries()) {
    if (now - new Date(chat.createdAt).getTime() > CHAT_TTL_MS) {
      chats.delete(token);
      messages.delete(token);
    }
  }
}

export function addReport(payload) {
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
  reports.push(report);
  return report;
}

export function hasRecentReport({ fingerprint, cutoff }) {
  if (!reports.length) return false;
  const cutoffTime = new Date(cutoff).getTime();
  for (let i = reports.length - 1; i >= 0; i -= 1) {
    const report = reports[i];
    const createdTime = new Date(report.createdAt).getTime();
    if (createdTime < cutoffTime) {
      break;
    }
    if (
      report.fingerprint === fingerprint &&
      (report.type === 'bug' || report.type === 'improvement')
    ) {
      return true;
    }
  }
  return false;
}

export function listReports() {
  return reports
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function ensureCreator(id, seedLimit) {
  const existing = creators.get(id);
  if (existing) return existing;
  const tier = seedCreatorCount < seedLimit ? 'seed' : 'standard';
  const creator = { id, tier, createdAt: new Date().toISOString() };
  creators.set(id, creator);
  if (tier === 'seed') {
    seedCreatorCount += 1;
  }
  return creator;
}

export function addChatCreation({ creatorId, fingerprint }) {
  chatCreations.push({
    id: createId(),
    creatorId: creatorId || null,
    fingerprint: fingerprint || '',
    createdAt: new Date().toISOString(),
  });
  return true;
}

export function hasRecentChatCreation({ creatorId, cutoff }) {
  if (!chatCreations.length) return false;
  const cutoffTime = new Date(cutoff).getTime();
  for (let i = chatCreations.length - 1; i >= 0; i -= 1) {
    const entry = chatCreations[i];
    const createdTime = new Date(entry.createdAt).getTime();
    if (createdTime < cutoffTime) {
      break;
    }
    if (entry.creatorId === creatorId) {
      return true;
    }
  }
  return false;
}

export function countRecentChatCreationsByFingerprint({ fingerprint, cutoff }) {
  if (!chatCreations.length) return 0;
  const cutoffTime = new Date(cutoff).getTime();
  let count = 0;
  for (let i = chatCreations.length - 1; i >= 0; i -= 1) {
    const entry = chatCreations[i];
    const createdTime = new Date(entry.createdAt).getTime();
    if (createdTime < cutoffTime) {
      break;
    }
    if (entry.fingerprint === fingerprint) {
      count += 1;
    }
  }
  return count;
}

function getChatInternal(token) {
  const chat = chats.get(token);
  if (!chat) return null;
  if (isExpired(chat.createdAt)) {
    chats.delete(token);
    messages.delete(token);
    return null;
  }
  return chat;
}

function isExpired(createdAt) {
  return Date.now() - new Date(createdAt).getTime() > CHAT_TTL_MS;
}

function normalizePasscode(passcode) {
  return String(passcode || '').trim().toUpperCase();
}

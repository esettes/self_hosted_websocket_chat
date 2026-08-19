import http from 'http';
import path from 'path';
import express from 'express';
import { fileURLToPath } from 'url';

import * as memoryStore from './storage/memoryStore.js';
import { initSqliteStore } from './storage/sqliteStore.js';
import { setupChatHub } from './ws/chatHub.js';
import { createToken } from './utils/tokens.js';
import { buildFingerprint } from './utils/fingerprint.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, '..', '..', 'public');
const defaultDbPath = path.join(__dirname, '..', 'db', 'chat.sqlite');

const store =
  process.env.STORE === 'memory'
    ? memoryStore
    : initSqliteStore(process.env.DB_PATH || defaultDbPath);
const adminToken = process.env.ADMIN_TOKEN || '';
const CHAT_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const CREATOR_SEED_LIMIT = readPositiveInt(process.env.CREATOR_SEED_LIMIT, 50);
const CREATOR_SEED_DAILY_LIMIT = readPositiveInt(
  process.env.CREATOR_SEED_DAILY_LIMIT,
  5
);
const TRUST_PROXY_HOPS = readPositiveInt(process.env.TRUST_PROXY_HOPS, 1);
const CREATOR_COOKIE_NAME = 'tkn_creator';
const CREATOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const app = express();
const server = http.createServer(app);

app.disable('x-powered-by');
app.set('trust proxy', TRUST_PROXY_HOPS);
app.use(express.json());
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    const status = res.statusCode;
    if (!shouldAutoReport(req, status)) return;
    try {
      const ip = normalizeText(req.ip, 200);
      const userAgent = normalizeText(req.headers['user-agent'], 400);
      const fingerprint = buildFingerprint(ip, userAgent);
      const pathValue = req.originalUrl || req.path || '';
      const description = buildAutoDescription({
        kind: 'http_response',
        status,
        statusText: res.statusMessage || '',
        method: req.method,
        url: pathValue,
      });
      const steps = buildAutoSteps({
        kind: 'http_response',
        status,
        statusText: res.statusMessage || '',
        method: req.method,
        url: pathValue,
        durationMs: Date.now() - startedAt,
        referer: normalizeText(req.headers.referer, 200),
      });
      store.addReport({
        type: 'error',
        steps: steps || null,
        description,
        page: normalizeText(pathValue, 200) || null,
        chatToken: extractChatTokenFromPath(pathValue) || null,
        fingerprint,
      });
    } catch (err) {
      console.error('auto report failed', err);
    }
  });
  next();
});

app.get('/', (req, res) => {
  ensureCreator(req, res);
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.use(express.static(publicDir));

const cleanupIntervalMs = 30 * 60 * 1000;
if (typeof store.cleanupExpired === 'function') {
  store.cleanupExpired();
  setInterval(() => {
    try {
      store.cleanupExpired();
    } catch (err) {
      console.error('cleanup failed', err);
    }
  }, cleanupIntervalMs);
}

app.get('/api/chats', (req, res) => {
  res.json({ chats: store.listChats() });
});

app.post('/api/chats', (req, res) => {
  const requirePasscode = req.body?.requirePasscode !== false;
  const name = normalizeText(req.body?.name, 60);
  const ip = normalizeText(req.ip, 200);
  const userAgent = normalizeText(req.headers['user-agent'], 400);
  const fingerprint = buildFingerprint(ip, userAgent);
  const creator = ensureCreator(req, res);
  const cutoff = new Date(Date.now() - CHAT_LIMIT_WINDOW_MS).toISOString();

  if (creator.tier === 'seed') {
    const recentCount = store.countRecentChatCreationsByFingerprint({
      fingerprint,
      cutoff,
    });
    if (recentCount >= CREATOR_SEED_DAILY_LIMIT) {
      res.status(429).json({ error: 'chat_limit' });
      return;
    }
  } else if (store.hasRecentChatCreation({ creatorId: creator.id, cutoff })) {
    res.status(429).json({ error: 'chat_limit' });
    return;
  }

  const chat = store.createChat({ requirePasscode, name: name || null });
  store.addChatCreation({ creatorId: creator.id, fingerprint });
  const { ownerKey, passcode, ...publicChat } = chat;
  res.status(201).json({ chat: publicChat, ownerKey, passcode });
});

app.get('/api/chats/:token', (req, res) => {
  const chat = store.getChat(req.params.token);
  if (!chat) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json({ chat });
});

app.post('/api/chats/:token/access', (req, res) => {
  const token = req.params.token;
  const chat = store.getChat(token);
  if (!chat) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  const passcode = req.body?.passcode;
  if (!store.verifyPasscode(token, passcode)) {
    res.status(403).json({ error: 'invalid_passcode' });
    return;
  }

  res.json({ ok: true });
});

app.delete('/api/chats/:token', (req, res) => {
  const token = req.params.token;
  const chat = store.getChat(token);
  if (!chat) {
    store.deleteChat(token);
    res.json({ ok: true, gone: true });
    return;
  }

  const ownerKey = req.body?.ownerKey;
  const adminHeader = req.headers['x-admin-token'];
  const isAdmin =
    adminToken && typeof adminHeader === 'string' && adminHeader === adminToken;
  const isOwner = store.isOwner(token, ownerKey);

  if (!isAdmin && !isOwner) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }

  store.deleteChat(token);
  res.json({ ok: true });
});

app.post('/api/chats/:token/claim', (req, res) => {
  const token = req.params.token;
  const chat = store.getChat(token);
  if (!chat) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  const adminHeader = req.headers['x-admin-token'];
  const isAdmin =
    adminToken && typeof adminHeader === 'string' && adminHeader === adminToken;

  if (!isAdmin) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }

  const ownerKey = store.claimOwner(token);
  if (!ownerKey) {
    res.status(409).json({ error: 'owner_exists' });
    return;
  }

  res.json({ ownerKey });
});

app.post('/api/chats/:token/passcode', (req, res) => {
  const token = req.params.token;
  const chat = store.getChat(token);
  if (!chat) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  const ownerKey = req.body?.ownerKey;
  const passcode = store.revealPasscode(token, ownerKey);
  if (!passcode) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }

  res.json({ passcode });
});

app.get('/api/active', (req, res) => {
  const adminHeader = req.headers['x-admin-token'];
  const isAdmin =
    adminToken && typeof adminHeader === 'string' && adminHeader === adminToken;

  if (!isAdmin) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }

  res.json({ active: chatHub.getActiveCount() });
});

app.post('/api/auto-reports', (req, res) => {
  const kind = normalizeText(req.body?.kind, 40);
  if (!kind) {
    res.status(400).json({ error: 'missing_kind' });
    return;
  }

  const message = normalizeText(req.body?.message, 4000);
  const stack = normalizeText(req.body?.stack, 2000);
  const url = normalizeText(req.body?.url, 400);
  const responseUrl = normalizeText(req.body?.responseUrl, 400);
  const method = normalizeText(req.body?.method, 12).toUpperCase();
  const statusRaw = Number.parseInt(req.body?.status, 10);
  const status = Number.isFinite(statusRaw) ? statusRaw : null;
  const statusText = normalizeText(req.body?.statusText, 120);
  const durationRaw = Number.parseInt(req.body?.durationMs, 10);
  const durationMs = Number.isFinite(durationRaw) ? durationRaw : null;
  const page = normalizeText(req.body?.page, 200);
  const chatToken = normalizeText(req.body?.chatToken, 120);

  if (!message && !stack && status === null) {
    res.status(400).json({ error: 'missing_detail' });
    return;
  }

  const ip = normalizeText(req.ip, 200);
  const userAgent = normalizeText(req.headers['user-agent'], 400);
  const fingerprint = buildFingerprint(ip, userAgent);

  const description = buildAutoDescription({
    kind,
    message,
    status,
    statusText,
    method,
    url,
  });
  const steps = buildAutoSteps({
    kind,
    status,
    statusText,
    method,
    url,
    responseUrl,
    durationMs,
    stack,
  });

  store.addReport({
    type: 'error',
    steps: steps || null,
    description,
    page: page || null,
    chatToken: chatToken || null,
    fingerprint,
  });

  res.status(201).json({ ok: true });
});

app.get('/c/:token', (req, res) => {
  ensureCreator(req, res);
  res.sendFile(path.join(publicDir, 'chat.html'));
});

const chatHub = setupChatHub(server, store);

server.listen(8080, '10.44.0.2', () => {
  console.log('server listening on http://10.44.0.2:8080');
});

function ensureCreator(req, res) {
  const creatorId = getOrCreateCreatorId(req, res);
  return store.ensureCreator(creatorId, CREATOR_SEED_LIMIT);
}

function getOrCreateCreatorId(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  const existing = cookies[CREATOR_COOKIE_NAME];
  if (isValidCreatorId(existing)) {
    return existing;
  }

  const creatorId = createToken(16);
  setCookie(res, CREATOR_COOKIE_NAME, creatorId, {
    httpOnly: true,
    maxAge: CREATOR_COOKIE_MAX_AGE,
    sameSite: 'Lax',
    secure: isSecureRequest(req),
    path: '/',
  });
  return creatorId;
}

function parseCookies(headerValue) {
  const result = {};
  if (typeof headerValue !== 'string' || !headerValue) return result;
  const pairs = headerValue.split(';');
  for (const pair of pairs) {
    const index = pair.indexOf('=');
    if (index === -1) continue;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(value);
    } catch {
      result[key] = value;
    }
  }
  return result;
}

function setCookie(res, name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge) parts.push(`Max-Age=${options.maxAge}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.secure) parts.push('Secure');
  const headerValue = parts.join('; ');
  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', headerValue);
  } else if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, headerValue]);
  } else {
    res.setHeader('Set-Cookie', [existing, headerValue]);
  }
}

function isSecureRequest(req) {
  if (req.secure) return true;
  const forwarded = req.headers['x-forwarded-proto'];
  return typeof forwarded === 'string' && forwarded.split(',')[0].trim() === 'https';
}

function isValidCreatorId(value) {
  return typeof value === 'string' && /^[a-f0-9]{32}$/i.test(value);
}

function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function shouldAutoReport(req, status) {
  if (!Number.isFinite(status) || status < 400) return false;
  if (req.method === 'OPTIONS') return false;
  const pathValue = req.path || req.url || '';
  if (pathValue.startsWith('/api/auto-reports')) return false;
  if (status < 500 && !pathValue.startsWith('/api/')) return false;
  if (isStaticAsset(pathValue)) return false;
  return true;
}

function isStaticAsset(pathValue) {
  return (
    pathValue.startsWith('/assets/') ||
    pathValue.startsWith('/css/') ||
    pathValue.startsWith('/js/')
  );
}

function extractChatTokenFromPath(pathValue) {
  const cleanPath = String(pathValue || '').split('?')[0];
  const parts = cleanPath.split('/').filter(Boolean);
  if (parts[0] === 'c' && parts[1]) return parts[1];
  if (parts[0] === 'api' && parts[1] === 'chats' && parts[2]) return parts[2];
  return '';
}

function buildAutoDescription({ kind, message, status, statusText, method, url }) {
  const parts = [];
  if (message) parts.push(message);
  if (Number.isFinite(status)) {
    const statusLine = statusText ? `HTTP ${status} ${statusText}` : `HTTP ${status}`;
    parts.push(statusLine.trim());
  }
  if (method || url) {
    parts.push(`${method || 'GET'} ${url || ''}`.trim());
  }
  if (!parts.length && kind) {
    parts.push(`Auto report: ${kind}`);
  }
  return normalizeText(parts.join(' | '), 4000) || 'Automatic error report';
}

function buildAutoSteps({
  kind,
  status,
  statusText,
  method,
  url,
  responseUrl,
  durationMs,
  stack,
  referer,
}) {
  const lines = [];
  if (kind) lines.push(`Kind: ${kind}`);
  if (Number.isFinite(status)) {
    const statusLine = statusText ? `${status} ${statusText}` : `${status}`;
    lines.push(`Status: ${statusLine}`.trim());
  }
  if (method || url) {
    lines.push(`Request: ${method || 'GET'} ${url || ''}`.trim());
  }
  if (responseUrl && responseUrl !== url) {
    lines.push(`Response URL: ${responseUrl}`);
  }
  if (Number.isFinite(durationMs)) {
    lines.push(`Duration: ${Math.round(durationMs)}ms`);
  }
  if (referer) {
    lines.push(`Referer: ${referer}`);
  }
  if (stack) {
    lines.push(`Stack:\n${stack}`);
  }
  return normalizeText(lines.join('\n'), 2000);
}

function normalizeText(value, maxLen) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

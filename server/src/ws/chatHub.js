import { WebSocketServer } from 'ws';
import { createId } from '../utils/tokens.js';

const MAX_TEXT = 2000;
const MAX_NAME = 60;
const MAX_USER_ID = 80;
const PING_INTERVAL_MS = 30_000;

export function setupChatHub(server, store) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const rooms = new Map();
  let activeCount = 0;

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (client.isAlive === false) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, PING_INTERVAL_MS);

  wss.on('close', () => {
    clearInterval(heartbeat);
  });

  wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    const url = new URL(req.url, `http://${req.headers.host}`);
    const chatToken = url.searchParams.get('chat');
    const passcode = url.searchParams.get('passcode');
    const chat = chatToken ? store.getChat(chatToken) : null;

    if (!chat) {
      ws.close(1008, 'invalid chat');
      return;
    }

    if (!store.verifyPasscode(chatToken, passcode)) {
      ws.close(1008, 'invalid passcode');
      return;
    }

    const room = rooms.get(chatToken) || new Set();
    rooms.set(chatToken, room);
    room.add(ws);
    activeCount += 1;

    const backlog = store.listMessages(chatToken);
    ws.send(
      JSON.stringify({
        type: 'init',
        payload: { chat, messages: backlog },
      })
    );

    ws.on('message', (data) => {
      const incoming = safeJson(data);
      if (!incoming || incoming.type !== 'message') return;

      const payload = incoming.payload || {};
      const text = normalizeText(payload.text, MAX_TEXT);
      if (!text) return;

      const author = normalizeText(payload.author, MAX_NAME) || 'anonymous';
      const userId = normalizeText(payload.userId, MAX_USER_ID) || null;
      const message = {
        id: createId(),
        chatToken,
        author,
        text,
        userId,
        createdAt: new Date().toISOString(),
      };

      store.addMessage(chatToken, message);
      broadcast(room, { type: 'message', payload: message });
    });

    ws.on('close', () => {
      room.delete(ws);
      if (room.size === 0) {
        rooms.delete(chatToken);
      }
      activeCount = Math.max(0, activeCount - 1);
    });
  });

  return {
    getActiveCount() {
      return activeCount;
    },
  };
}

function broadcast(room, event) {
  const data = JSON.stringify(event);
  for (const client of room) {
    if (client.readyState === 1) {
      client.send(data);
    }
  }
}

function safeJson(data) {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function normalizeText(value, maxLen) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

const token = getToken();
const statusEl = document.getElementById('status');
const messagesEl = document.getElementById('messages');
const formEl = document.getElementById('message-form');
const inputEl = document.getElementById('message-input');
const authorEl = document.getElementById('author');
const shareInput = document.getElementById('share-link');
const copyBtn = document.getElementById('copy-link');
const passcodeBox = document.getElementById('passcode-box');
const passcodeValue = document.getElementById('passcode-value');
const showPasscodeBtn = document.getElementById('show-passcode');
const claimBtn = document.getElementById('claim-chat');
const deleteBtn = document.getElementById('delete-chat');
const passcodeGate = document.getElementById('passcode-gate');
const passcodeForm = document.getElementById('passcode-form');
const passcodeInput = document.getElementById('passcode-input');
const passcodeError = document.getElementById('passcode-error');
const chatContent = document.getElementById('chat-content');
const idleGate = document.getElementById('idle-gate');
const reloadBtn = document.getElementById('reload-chat');
const activeCountEl = document.getElementById('active-count');
const titleEl = document.getElementById('chat-title');

const userColorCache = new Map();

const adminToken = captureAdminToken();
let ownerKey = token ? localStorage.getItem(ownerKeyKey(token)) : '';
let passcode = token ? localStorage.getItem(passcodeKey(token)) : '';
let passcodeState = token ? localStorage.getItem(passcodeStateKey(token)) : '';
if (passcode) {
  passcodeState = 'set';
}
if (passcodeState === 'none') {
  passcode = '';
}
let passcodeKnown = passcodeState === 'set' || passcodeState === 'none';
const savedAuthor = token ? safeStorageGet(authorKey(token)) : '';
if (savedAuthor) {
  authorEl.value = savedAuthor;
}
const userId = token ? getOrCreateUserId(token) : '';
const IDLE_LIMIT_MS = 6 * 60 * 1000;
const IDLE_CHECK_MS = 30 * 1000;
let lastActivity = Date.now();
let idleLocked = false;
let claimBlocked = false;

updateActions();

shareInput.value = window.location.href;

if (adminToken && activeCountEl) {
  activeCountEl.hidden = false;
  startActiveCount(adminToken, activeCountEl);
}

reloadBtn.addEventListener('click', () => {
  window.location.reload();
});

trackActivity();

copyBtn.addEventListener('click', async () => {
  const text = shareInput.value;
  let copied = false;
  try {
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      copied = true;
    }
  } catch (err) {
    console.error(err);
  }

  if (!copied) {
    copied = copyWithSelection(text);
    if (!copied) {
      try {
        shareInput.focus();
        shareInput.select();
        shareInput.setSelectionRange(0, shareInput.value.length);
      } catch (err) {
        console.error(err);
      }
    }
  }

  copyBtn.textContent = copied ? 'Copiado' : 'Selecciona y copia';
  setTimeout(() => {
    copyBtn.textContent = 'Copiar';
  }, 1200);
});

const persistAuthorFromInput = () => {
  if (!token || !authorEl) return;
  persistAuthor(authorEl.value);
};

authorEl.addEventListener('input', persistAuthorFromInput);
authorEl.addEventListener('change', persistAuthorFromInput);
authorEl.addEventListener('blur', persistAuthorFromInput);

window.addEventListener('beforeunload', () => {
  if (!authorEl) return;
  persistAuthor(authorEl.value);
});

window.addEventListener('pagehide', () => {
  if (!authorEl) return;
  persistAuthor(authorEl.value);
});

showPasscodeBtn.addEventListener('click', async () => {
  if (!token || !ownerKey) return;

  showPasscodeBtn.disabled = true;
  let nextLabel = 'Mostrar contraseña';
  try {
    if (!passcodeKnown) {
      const res = await fetch(`/api/chats/${encodeURIComponent(token)}/passcode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerKey }),
      });

      if (!res.ok) {
        throw new Error('passcode failed');
      }

      const data = await res.json();
      passcode = data.passcode || '';
      passcodeState = passcode ? 'set' : 'none';
      passcodeKnown = true;
      if (passcode) {
        localStorage.setItem(passcodeKey(token), passcode);
        localStorage.setItem(passcodeStateKey(token), 'set');
      } else {
        localStorage.removeItem(passcodeKey(token));
        localStorage.setItem(passcodeStateKey(token), 'none');
      }
      updateActions();
    }

    passcodeValue.value =
      passcodeState === 'none' ? 'Sin contraseña' : passcode || 'Oculta';
    nextLabel = passcodeState === 'none' ? 'Sin contraseña' : 'Mostrada';
    showPasscodeBtn.textContent = nextLabel;
    if (passcode && passcodeGate.hidden === false) {
      const accessOk = await requestAccess(passcode);
      if (accessOk) {
        setAccess(true);
        if (!socket || socket.readyState !== 1) {
          connect();
        }
      }
    }
  } catch (err) {
    console.error(err);
    showPasscodeBtn.textContent = 'Error';
  } finally {
    setTimeout(() => {
      showPasscodeBtn.disabled = false;
      if (showPasscodeBtn.textContent === 'Error') {
        showPasscodeBtn.textContent = nextLabel;
      }
    }, 1200);
  }
});

claimBtn.addEventListener('click', async () => {
  if (!token || !adminToken) return;

  claimBtn.disabled = true;
  try {
    const res = await fetch(`/api/chats/${encodeURIComponent(token)}/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': adminToken,
      },
    });

    if (!res.ok) {
      if (res.status === 404) {
        window.location.href = '/';
        return;
      }
      if (res.status === 409) {
        claimBlocked = true;
        updateActions();
        return;
      }
      claimBtn.textContent =
        res.status === 403 ? 'Se requiere administración' : 'Error';
      claimBtn.disabled = false;
      setTimeout(() => {
        updateActions();
      }, 1200);
      return;
    }

    const data = await res.json();
    ownerKey = data.ownerKey;
    localStorage.setItem(ownerKeyKey(token), ownerKey);
    updateActions();
  } catch (err) {
    console.error(err);
    claimBtn.textContent = 'Error';
    claimBtn.disabled = false;
    setTimeout(() => {
      updateActions();
    }, 1200);
  }
});

deleteBtn.addEventListener('click', async () => {
  if (!token) return;
  const confirmed = window.confirm(
    '¿Eliminar este chat? Esto borrará todos los mensajes.'
  );
  if (!confirmed) return;

  deleteBtn.disabled = true;
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (adminToken) headers['x-admin-token'] = adminToken;

    const res = await fetch(`/api/chats/${encodeURIComponent(token)}`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ ownerKey }),
    });

    if (!res.ok) {
      if (res.status === 404) {
        window.location.href = '/';
        return;
      }
      throw new Error('delete failed');
    }

    localStorage.removeItem(ownerKeyKey(token));
    window.location.href = '/';
  } catch (err) {
    console.error(err);
    deleteBtn.textContent = 'Error';
    deleteBtn.disabled = false;
    setTimeout(() => {
      deleteBtn.textContent = 'Eliminar chat';
    }, 1200);
  }
});

let socket = null;

init();

async function init() {
  if (!token) {
    setStatus('falta token');
    return;
  }

  const res = await fetch(`/api/chats/${encodeURIComponent(token)}`);
  if (!res.ok) {
    setStatus('chat no encontrado');
    return;
  }

  try {
    const data = await res.json();
    if (data && data.chat) {
      setChatTitle(data.chat.name || '');
    }
  } catch (err) {
    console.error(err);
  }

  const accessOk = await requestAccess(passcode);
  if (!accessOk) {
    setStatus('contraseña requerida');
    setAccess(false);
    return;
  }

  setAccess(true);
  connect();
}

function connect() {
  if (idleLocked) return;
  setStatus('conectando');
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const wsUrl = `${proto}://${location.host}/ws?chat=${encodeURIComponent(token)}&passcode=${encodeURIComponent(passcode || '')}`;
  socket = new WebSocket(wsUrl);

  socket.addEventListener('open', () => setStatus('conectado'));
  socket.addEventListener('close', () => setStatus('desconectado'));
  socket.addEventListener('message', (event) => {
    const data = safeJson(event.data);
    if (!data) return;

    if (data.type === 'init') {
      const messages = data.payload?.messages || [];
      messagesEl.innerHTML = '';
      messages.forEach(addMessage);
      scrollToEnd();
    }

    if (data.type === 'message') {
      addMessage(data.payload);
      scrollToEnd();
    }
  });
}

formEl.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = inputEl.value.trim();
  if (!text || !socket || socket.readyState !== 1) return;

  const payload = {
    text,
    author: authorEl.value.trim(),
    userId,
  };

  if (token) {
    persistAuthor(authorEl.value);
  }

  socket.send(JSON.stringify({ type: 'message', payload }));
  inputEl.value = '';
  inputEl.focus();
});

passcodeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const value = normalizePasscode(passcodeInput.value);
  if (!value) return;

  const ok = await requestAccess(value);
  if (!ok) {
    passcodeError.hidden = false;
    return;
  }

  passcodeError.hidden = true;
  passcode = value;
  passcodeKnown = true;
  passcodeState = 'set';
  localStorage.setItem(passcodeKey(token), passcode);
  localStorage.setItem(passcodeStateKey(token), 'set');
  setAccess(true);
  connect();
});

passcodeInput.addEventListener('input', () => {
  passcodeInput.value = normalizePasscode(passcodeInput.value);
  passcodeError.hidden = true;
});

function addMessage(message) {
  if (!message || !message.text) return;

  const item = document.createElement('li');
  item.className = 'message';

  const meta = document.createElement('div');
  meta.className = 'meta';
  const author = message.author || 'anónimo';
  const time = message.createdAt
    ? new Date(message.createdAt).toLocaleTimeString('es-ES')
    : '';
  meta.textContent = time ? `${author} - ${time}` : author;

  const body = document.createElement('div');
  body.className = 'body';
  body.textContent = message.text;

  const colorKey = message.userId || author;
  const colorInfo = getUserColor(colorKey);
  item.style.setProperty('--user-color', colorInfo.color);
  item.style.setProperty('--user-color-rgb', colorInfo.rgb);

  item.append(body, meta);
  messagesEl.appendChild(item);
}

function scrollToEnd() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setStatus(text) {
  statusEl.textContent = text;
}

function setChatTitle(name) {
  if (!titleEl) return;
  const cleanName = String(name || '').trim();
  const titleText = cleanName ? `Chat: ${cleanName}` : 'Chat';
  titleEl.textContent = titleText;
  document.title = titleText;
}

function getToken() {
  const parts = window.location.pathname.split('/');
  return parts[2] || '';
}

function ownerKeyKey(tokenValue) {
  return `chat-owner:${tokenValue}`;
}

function passcodeKey(tokenValue) {
  return `chat-passcode:${tokenValue}`;
}

function passcodeStateKey(tokenValue) {
  return `chat-passcode-state:${tokenValue}`;
}

function authorKey(tokenValue) {
  return `chat-author:${tokenValue}`;
}

function userIdKey(tokenValue) {
  return `chat-user:${tokenValue}`;
}

function getOrCreateUserId(tokenValue) {
  const key = userIdKey(tokenValue);
  const stored = localStorage.getItem(key);
  if (stored) return stored;
  const id = createClientId();
  localStorage.setItem(key, id);
  return id;
}

function createClientId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `user-${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
}

function updateActions() {
  deleteBtn.hidden = !ownerKey && !adminToken;
  claimBtn.hidden = !adminToken || Boolean(ownerKey);
  if (!claimBtn.hidden) {
    if (claimBlocked) {
      claimBtn.textContent = 'Propietario ya asignado';
      claimBtn.disabled = true;
    } else {
      claimBtn.textContent = 'Reclamar chat';
      claimBtn.disabled = false;
    }
  }
  passcodeBox.hidden = !ownerKey || passcodeState === 'none';
}

function setAccess(allowed) {
  if (idleLocked) {
    passcodeGate.hidden = true;
    chatContent.hidden = true;
    idleGate.hidden = false;
    return;
  }
  passcodeGate.hidden = allowed;
  chatContent.hidden = !allowed;
  idleGate.hidden = true;
  if (!allowed) {
    passcodeInput.value = '';
    passcodeError.hidden = true;
  }
}

async function requestAccess(value) {
  try {
    const res = await fetch(`/api/chats/${encodeURIComponent(token)}/access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: value || '' }),
    });

    if (!res.ok) {
      if (value) {
        localStorage.removeItem(passcodeKey(token));
        localStorage.removeItem(passcodeStateKey(token));
        passcode = '';
        passcodeState = '';
        passcodeKnown = false;
      }
      return false;
    }

    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

function normalizePasscode(value) {
  return String(value || '').trim().toUpperCase();
}

function trackActivity() {
  const update = () => {
    if (idleLocked) return;
    lastActivity = Date.now();
  };

  const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
  for (const event of events) {
    document.addEventListener(event, update, { passive: true });
  }

  setInterval(() => {
    if (idleLocked) return;
    if (Date.now() - lastActivity > IDLE_LIMIT_MS) {
      lockIdle();
    }
  }, IDLE_CHECK_MS);
}

function lockIdle() {
  idleLocked = true;
  setStatus('inactivo - recarga necesaria');
  try {
    if (socket) {
      socket.close(1000, 'idle timeout');
    }
  } catch {
    // ignore close errors
  }
  setAccess(false);
}

function getUserColor(author) {
  const key = String(author || 'anónimo').toLowerCase();
  if (userColorCache.has(key)) {
    return userColorCache.get(key);
  }

  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }

  const hue = hash % 360;
  const rgb = hslToRgb(hue, 70, 55);
  const color = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  const result = { color, rgb: `${rgb.r}, ${rgb.g}, ${rgb.b}` };
  userColorCache.set(key, result);
  return result;
}

function hslToRgb(hue, saturation, lightness) {
  const s = saturation / 100;
  const l = lightness / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const h = hue / 60;
  const x = c * (1 - Math.abs((h % 2) - 1));

  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (h >= 0 && h < 1) {
    r1 = c;
    g1 = x;
  } else if (h >= 1 && h < 2) {
    r1 = x;
    g1 = c;
  } else if (h >= 2 && h < 3) {
    g1 = c;
    b1 = x;
  } else if (h >= 3 && h < 4) {
    g1 = x;
    b1 = c;
  } else if (h >= 4 && h < 5) {
    r1 = x;
    b1 = c;
  } else if (h >= 5 && h < 6) {
    r1 = c;
    b1 = x;
  }

  const m = l - c / 2;
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

function captureAdminToken() {
  const params = new URLSearchParams(window.location.search);
  const tokenValue = params.get('admin');
  if (tokenValue) {
    localStorage.setItem('admin-token', tokenValue);
    params.delete('admin');
    const query = params.toString();
    const nextUrl = query ? `${location.pathname}?${query}` : location.pathname;
    history.replaceState({}, '', nextUrl);
    return tokenValue;
  }

  return localStorage.getItem('admin-token') || '';
}

function startActiveCount(tokenValue, element) {
  const update = async () => {
    try {
      const res = await fetch('/api/active', {
        headers: { 'x-admin-token': tokenValue },
      });
      if (!res.ok) {
        if (res.status === 403) {
          element.hidden = true;
        }
        return;
      }
      const data = await res.json();
      element.textContent = `Usuarios activos: ${data.active}`;
    } catch (err) {
      console.error(err);
    }
  };

  update();
  setInterval(update, 15000);
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function persistAuthor(value) {
  if (!token) return;
  const cleanValue = String(value || '').trim();
  try {
    if (cleanValue) {
      localStorage.setItem(authorKey(token), cleanValue);
    } else {
      localStorage.removeItem(authorKey(token));
    }
  } catch (err) {
    console.error(err);
  }
}

function safeStorageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (err) {
    console.error(err);
    return '';
  }
}

function copyWithSelection(value) {
  if (!value) return false;
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch (err) {
    console.error(err);
  }
  document.body.removeChild(textarea);
  return ok;
}

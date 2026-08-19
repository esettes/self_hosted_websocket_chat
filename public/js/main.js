const listEl = document.getElementById('chat-list');
const emptyEl = document.getElementById('chat-empty');
const newBtn = document.getElementById('new-chat-btn');
const chatsPanelEl = document.getElementById('chats-panel');
const homeCtaEl = document.getElementById('home-cta');
const activeCountEl = document.getElementById('active-count');
const modal = document.getElementById('new-chat-modal');
const modalCard = modal ? modal.querySelector('.modal-card') : null;
const modalForm = document.getElementById('new-chat-form');
const modalName = document.getElementById('new-chat-name');
const modalPrivate = document.getElementById('new-chat-private');
const modalPublic = document.getElementById('new-chat-public');
const modalClose = document.getElementById('new-chat-close');
const modalCancel = document.getElementById('new-chat-cancel');
const modalSubmit = document.getElementById('new-chat-submit');
const adminToken = captureAdminToken();

if (adminToken && activeCountEl) {
  activeCountEl.hidden = false;
  startActiveCount(adminToken, activeCountEl);
}

window.addEventListener('resize', () => {
  updateNewChatButtonPlacement();
});

newBtn.addEventListener('click', () => {
  openModal();
});

if (modalForm) {
  modalForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (modalSubmit.disabled) return;

    modalSubmit.disabled = true;
    newBtn.disabled = true;
    try {
      const name = normalizeChatName(modalName.value);
      const requirePasscode = Boolean(modalPrivate?.checked);
      const res = await fetch('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requirePasscode, name: name || null }),
      });
      if (!res.ok) throw new Error('create failed');
      const data = await res.json();
      if (data.ownerKey) {
        localStorage.setItem(ownerKeyKey(data.chat.token), data.ownerKey);
      }
      if (data.passcode) {
        localStorage.setItem(passcodeKey(data.chat.token), data.passcode);
        localStorage.setItem(passcodeStateKey(data.chat.token), 'set');
      } else {
        localStorage.setItem(passcodeStateKey(data.chat.token), 'none');
      }
      closeModal();
      window.location.href = `/c/${data.chat.token}`;
    } catch (err) {
      console.error(err);
      modalSubmit.textContent = 'Reintentar';
      setTimeout(() => {
        modalSubmit.textContent = 'Crear chat';
        modalSubmit.disabled = false;
        newBtn.disabled = false;
      }, 1200);
    }
  });
}

if (modalClose) {
  modalClose.addEventListener('click', () => closeModal());
}

if (modalCancel) {
  modalCancel.addEventListener('click', () => closeModal());
}

if (modal) {
  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) {
      closeModal();
    }
  });
}

if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', updateModalViewportPosition);
  window.visualViewport.addEventListener('scroll', updateModalViewportPosition);
}

window.addEventListener('orientationchange', () => {
  updateModalViewportPosition();
});

updateNewChatButtonPlacement();
loadChats();

async function loadChats() {
  const res = await fetch('/api/chats');
  if (!res.ok) return;
  const data = await res.json();
  renderChats(data.chats || []);
}

function renderChats(chats) {
  listEl.innerHTML = '';

  if (!chats.length) {
    emptyEl.hidden = false;
    updateNewChatButtonPlacement();
    return;
  }

  emptyEl.hidden = true;

  for (const chat of chats) {
    const item = document.createElement('li');
    item.className = 'chat-item';

    const link = document.createElement('a');
    link.className = 'chat-item-link';
    link.href = `/c/${chat.token}`;

    const name = document.createElement('span');
    name.className = 'chat-item-name';
    name.textContent = chat.name || `Chat ${chat.token}`;

    const meta = document.createElement('span');
    meta.className = 'chat-item-meta';
    meta.textContent = new Date(chat.createdAt).toLocaleString('es-ES');

    link.append(name, meta);
    item.appendChild(link);
    listEl.appendChild(item);
  }

  updateNewChatButtonPlacement();
}

function ownerKeyKey(token) {
  return `chat-owner:${token}`;
}

function passcodeKey(token) {
  return `chat-passcode:${token}`;
}

function passcodeStateKey(token) {
  return `chat-passcode-state:${token}`;
}

function normalizeChatName(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 60);
}

function openModal() {
  if (!modal) return;
  modal.hidden = false;
  updateModalViewportPosition();
  if (modalName) {
    modalName.value = '';
    modalName.focus();
    requestAnimationFrame(() => {
      updateModalViewportPosition();
    });
  }
  if (modalPrivate) {
    modalPrivate.checked = true;
  }
  if (modalPublic) {
    modalPublic.checked = false;
  }
}

function closeModal() {
  if (!modal) return;
  modal.hidden = true;
  modalSubmit.disabled = false;
  modalSubmit.textContent = 'Crear chat';
  newBtn.disabled = false;
  if (modalCard) {
    modalCard.style.transform = '';
    modalCard.style.maxHeight = '';
  }
}

function updateNewChatButtonPlacement() {
  if (!newBtn || !homeCtaEl || !chatsPanelEl) return;

  const ctaHeight = Math.ceil(newBtn.getBoundingClientRect().height || 50);
  const panelBottom = chatsPanelEl.getBoundingClientRect().bottom + window.scrollY;
  const requiredViewportHeight = panelBottom + ctaHeight + 30;
  const shouldFloat = requiredViewportHeight > window.innerHeight;

  homeCtaEl.classList.toggle('is-floating', shouldFloat);
  document.body.classList.toggle('cta-floating', shouldFloat);
}

function updateModalViewportPosition() {
  if (!modal || modal.hidden || !modalCard) return;
  const viewport = window.visualViewport;
  if (!viewport) {
    modalCard.style.transform = '';
    modalCard.style.maxHeight = '';
    return;
  }

  const centerY = viewport.offsetTop + viewport.height / 2;
  const layoutCenterY = window.innerHeight / 2;
  const deltaY = Math.round(centerY - layoutCenterY);
  modalCard.style.transform = `translateY(${deltaY}px)`;

  const maxHeight = Math.max(220, Math.floor(viewport.height - 24));
  modalCard.style.maxHeight = `${maxHeight}px`;
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

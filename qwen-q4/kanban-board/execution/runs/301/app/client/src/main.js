// --- State ---
let boardState = [];
let sse = null;
let reconnectTimer = null;
let isReconciling = false;

// --- API ---
const API_BASE = '';

async function fetchBoard() {
  const res = await fetch(`${API_BASE}/api/board`);
  if (!res.ok) throw new Error('Failed to fetch board');
  return res.json();
}

async function createCard(columnId, text) {
  const res = await fetch(`${API_BASE}/api/cards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ column_id: columnId, text })
  });
  if (!res.ok) throw new Error('Failed to create card');
  return res.json();
}

async function moveCard(cardId, columnId, beforeId, afterId) {
  const res = await fetch(`${API_BASE}/api/cards/${cardId}/move`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ column_id: columnId, before_id: beforeId, after_id: afterId })
  });
  if (!res.ok) throw new Error('Failed to move card');
  return res.json();
}

async function deleteCard(cardId) {
  const res = await fetch(`${API_BASE}/api/cards/${cardId}`, {
    method: 'DELETE'
  });
  if (!res.ok) throw new Error('Failed to delete card');
  return res.json();
}

// --- Rendering ---
const boardEl = document.getElementById('board');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');

function setStatus(status, text) {
  statusDot.className = `status-dot ${status}`;
  statusText.textContent = text;
}

function renderBoard() {
  boardEl.innerHTML = '';
  for (const column of boardState) {
    boardEl.appendChild(createColumnElement(column));
  }
}

function createColumnElement(column) {
  const colEl = document.createElement('div');
  colEl.className = 'column';
  colEl.dataset.columnId = column.id;

  // Header
  const header = document.createElement('div');
  header.className = 'column-header';
  const titleSpan = document.createElement('span');
  titleSpan.textContent = column.title;
  const countSpan = document.createElement('span');
  countSpan.className = 'card-count';
  countSpan.textContent = column.cards.length;
  header.appendChild(titleSpan);
  header.appendChild(countSpan);
  colEl.appendChild(header);

  // Cards list
  const cardsList = document.createElement('div');
  cardsList.className = 'cards-list';
  cardsList.dataset.columnId = column.id;

  for (const card of column.cards) {
    cardsList.appendChild(createCardElement(card));
  }

  colEl.appendChild(cardsList);

  // Add card form
  const form = document.createElement('div');
  form.className = 'add-card-form';
  const input = document.createElement('textarea');
  input.className = 'add-card-input';
  input.placeholder = 'Enter a title for this card...';
  input.rows = 1;
  const addBtn = document.createElement('button');
  addBtn.className = 'add-card-btn';
  addBtn.textContent = 'Add a card';
  const cancelBtn = document.createElement('div');
  cancelBtn.className = 'add-card-cancel';
  cancelBtn.textContent = 'Press ESC to cancel';
  cancelBtn.style.display = 'none';

  form.appendChild(input);
  form.appendChild(addBtn);
  form.appendChild(cancelBtn);
  colEl.appendChild(form);

  // Form handlers
  function submitCard() {
    const text = input.value.trim();
    if (text) {
      handleCreateCard(column.id, text, cardsList, input);
    }
  }

  addBtn.addEventListener('click', submitCard);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitCard();
    }
    if (e.key === 'Escape') {
      input.value = '';
      input.blur();
    }
  });

  input.addEventListener('focus', () => {
    addBtn.textContent = 'Save';
    cancelBtn.style.display = 'block';
  });

  input.addEventListener('blur', () => {
    if (!input.value.trim()) {
      addBtn.textContent = 'Add a card';
      cancelBtn.style.display = 'none';
    }
  });

  cancelBtn.addEventListener('click', () => {
    input.value = '';
    input.blur();
  });

  return colEl;
}

function createCardElement(card) {
  const cardEl = document.createElement('div');
  cardEl.className = 'card';
  cardEl.dataset.cardId = card.id;
  cardEl.dataset.position = card.position;
  cardEl.draggable = true;
  cardEl.textContent = card.text;

  cardEl.addEventListener('dragstart', handleDragStart);
  cardEl.addEventListener('dragend', handleDragEnd);

  return cardEl;
}

// --- Card Creation ---
async function handleCreateCard(columnId, text, cardsList, input) {
  // Optimistic: create card element immediately
  const tempId = 'temp-' + Date.now();
  const cardEl = createCardElement({ id: tempId, text, position: Infinity });
  cardsList.appendChild(cardEl);

  try {
    const card = await createCard(columnId, text);
    // Replace optimistic element with server-authoritative
    cardEl.remove();
    const newCardEl = createCardElement(card);
    cardsList.appendChild(newCardEl);
    updateColumnCount(columnId);
  } catch (err) {
    console.error('Failed to create card:', err);
    cardEl.remove();
  }

  input.value = '';
  input.focus();
}

// --- Drag and Drop ---
let draggedCardId = null;
let draggedCardEl = null;
let placeholder = null;

function handleDragStart(e) {
  draggedCardId = e.currentTarget.dataset.cardId;
  draggedCardEl = e.currentTarget;
  draggedCardEl.classList.add('dragging');

  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', draggedCardId);

  // Create placeholder
  placeholder = document.createElement('div');
  placeholder.className = 'drop-placeholder';
}

function handleDragEnd(e) {
  if (draggedCardEl) {
    draggedCardEl.classList.remove('dragging');
  }
  draggedCardId = null;
  draggedCardEl = null;

  // Remove placeholder
  if (placeholder && placeholder.parentNode) {
    placeholder.parentNode.removeChild(placeholder);
  }
  placeholder = null;

  // Remove drop indicators
  document.querySelectorAll('.card').forEach(c => {
    c.classList.remove('drop-above', 'drop-below');
  });
}

boardEl.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  if (!draggedCardEl) return;

  const cardEls = [...document.querySelectorAll('.card:not(.dragging)')];
  const target = getClosestCard(cardEls, e.clientY);

  // Remove all indicators
  cardEls.forEach(c => c.classList.remove('drop-above', 'drop-below'));

  if (target) {
    const rect = target.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (e.clientY < midY) {
      target.classList.add('drop-above');
    } else {
      target.classList.add('drop-below');
    }
  }

  // Move placeholder
  if (placeholder) {
    const cardsList = findCardsListForDrop(e.target);
    if (cardsList) {
      if (target) {
        const rect = target.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          cardsList.insertBefore(placeholder, target);
        } else {
          cardsList.insertBefore(placeholder, target.nextSibling);
        }
      } else {
        cardsList.appendChild(placeholder);
      }
    }
  }
});

boardEl.addEventListener('drop', async (e) => {
  e.preventDefault();

  if (!draggedCardId) return;

  const cardEls = [...document.querySelectorAll('.card:not(.dragging)')];
  const target = getClosestCard(cardEls, e.clientY);
  const cardsList = findCardsListForDrop(e.target);

  if (!cardsList) return;

  const targetColumnId = cardsList.dataset.columnId;

  // Calculate before and after IDs
  let beforeId = null;
  let afterId = null;

  if (target) {
    const rect = target.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (e.clientY < midY) {
      // Insert before target
      beforeId = target.dataset.cardId;
      const prevCard = target.previousElementSibling;
      if (prevCard && prevCard.classList.contains('card')) {
        afterId = prevCard.dataset.cardId;
      }
    } else {
      // Insert after target
      afterId = target.dataset.cardId;
      const nextCard = target.nextElementSibling;
      if (nextCard && nextCard.classList.contains('card')) {
        beforeId = nextCard.dataset.cardId;
      }
    }
  }

  // Optimistic UI update: move the card in the DOM
  const cardEl = document.querySelector(`.card[data-card-id="${draggedCardId}"]`);
  if (cardEl) {
    cardEl.classList.remove('dragging');
    cardEl.remove();

    if (placeholder && placeholder.parentNode === cardsList) {
      cardsList.insertBefore(cardEl, placeholder);
    } else {
      cardsList.appendChild(cardEl);
    }

    updateAllColumnCounts();
  }

  // Remove drop indicators
  document.querySelectorAll('.card').forEach(c => {
    c.classList.remove('drop-above', 'drop-below');
  });

  if (placeholder && placeholder.parentNode) {
    placeholder.parentNode.removeChild(placeholder);
  }
  placeholder = null;

  // Send to server
  try {
    await moveCard(draggedCardId, targetColumnId, beforeId, afterId);
    // Server will broadcast the canonical state via SSE
    // which will reconcile if needed
  } catch (err) {
    console.error('Failed to move card:', err);
    // On failure, the server will broadcast the correct state via SSE
  }

  draggedCardId = null;
  draggedCardEl = null;
});

function getClosestCard(cardEls, y) {
  let closest = null;
  let closestDist = Infinity;

  for (const card of cardEls) {
    const rect = card.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const dist = Math.abs(y - midY);
    if (dist < closestDist) {
      closestDist = dist;
      closest = card;
    }
  }

  return closest;
}

function findCardsListForDrop(target) {
  const el = target.closest('.cards-list');
  if (el) return el;

  const column = target.closest('.column');
  if (column) {
    return column.querySelector('.cards-list');
  }

  return null;
}

function updateColumnCount(columnId) {
  const colEl = document.querySelector(`.column[data-column-id="${columnId}"]`);
  if (colEl) {
    const count = colEl.querySelectorAll('.card').length;
    const countEl = colEl.querySelector('.card-count');
    if (countEl) countEl.textContent = count;
  }
}

function updateAllColumnCounts() {
  document.querySelectorAll('.column').forEach(col => {
    const count = col.querySelectorAll('.card').length;
    const countEl = col.querySelector('.card-count');
    if (countEl) countEl.textContent = count;
  });
}

// --- SSE Connection ---
function connectSSE() {
  if (sse) {
    sse.close();
  }

  setStatus('connecting', 'Connecting...');

  sse = new EventSource(`${API_BASE}/api/stream`);

  sse.onopen = () => {
    setStatus('connected', 'Connected');
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  sse.onerror = () => {
    setStatus('disconnected', 'Reconnecting...');
    reconnectTimer = setTimeout(connectSSE, 3000);
  };

  // Handle create events
  sse.addEventListener('create', (e) => {
    const data = JSON.parse(e.data);
    const { card, columnId } = data;

    const cardsList = document.querySelector(`.cards-list[data-column-id="${columnId}"]`);
    if (!cardsList) return;

    // Check if card already exists (avoid duplicates)
    const existing = document.querySelector(`.card[data-card-id="${card.id}"]`);
    if (existing) {
      existing.remove();
    }

    const cardEl = createCardElement(card);
    cardsList.appendChild(cardEl);
    updateColumnCount(columnId);
  });

  // Handle move events - reconcile with server state
  sse.addEventListener('move', (e) => {
    const data = JSON.parse(e.data);
    const { card, columnId, oldColumnId } = data;

    // Don't reconcile if we're currently reconciling
    if (isReconciling) return;

    // Remove card from wherever it is
    const cardEl = document.querySelector(`.card[data-card-id="${card.id}"]`);
    if (cardEl) {
      cardEl.remove();
    }

    // Rebuild both affected columns
    if (oldColumnId && oldColumnId !== columnId) {
      rebuildColumn(oldColumnId);
    }
    rebuildColumn(columnId);
  });

  // Handle delete events
  sse.addEventListener('delete', (e) => {
    const data = JSON.parse(e.data);
    const { cardId, columnId } = data;

    const cardEl = document.querySelector(`.card[data-card-id="${cardId}"]`);
    if (cardEl) {
      cardEl.remove();
      updateColumnCount(columnId);
    }
  });

  // Handle renormalize events
  sse.addEventListener('renormalize', (e) => {
    const data = JSON.parse(e.data);
    const { columnId, cards } = data;

    const cardsList = document.querySelector(`.cards-list[data-column-id="${columnId}"]`);
    if (!cardsList) return;

    cardsList.innerHTML = '';
    for (const card of cards) {
      cardsList.appendChild(createCardElement(card));
    }
    updateColumnCount(columnId);
  });
}

// Rebuild a column from server state
async function rebuildColumn(columnId) {
  if (isReconciling) return;
  isReconciling = true;

  try {
    const board = await fetchBoard();
    const column = board.find(c => c.id === columnId);
    if (!column) {
      isReconciling = false;
      return;
    }

    const cardsList = document.querySelector(`.cards-list[data-column-id="${columnId}"]`);
    if (!cardsList) {
      isReconciling = false;
      return;
    }

    cardsList.innerHTML = '';
    for (const card of column.cards) {
      cardsList.appendChild(createCardElement(card));
    }
    updateColumnCount(columnId);
  } catch (err) {
    console.error('Failed to rebuild column:', err);
  } finally {
    isReconciling = false;
  }
}

// --- Initialization ---
async function init() {
  try {
    boardState = await fetchBoard();
    renderBoard();
    connectSSE();
  } catch (err) {
    console.error('Failed to initialize:', err);
    setStatus('disconnected', 'Failed to load board');
  }
}

init();

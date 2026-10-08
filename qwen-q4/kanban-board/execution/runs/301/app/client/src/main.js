// --- State ---
let boardState = [];
let sse = null;
let reconnectTimer = null;

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

// --- DOM Helpers ---
const boardEl = document.getElementById('board');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');

function setStatus(status, text) {
  statusDot.className = `status-dot ${status}`;
  statusText.textContent = text;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function getCardEl(cardId) {
  return document.querySelector(`.card[data-card-id="${cardId}"]`);
}

function getColumnEl(columnId) {
  return document.querySelector(`.column[data-column-id="${columnId}"]`);
}

function getCardsListEl(columnId) {
  const colEl = getColumnEl(columnId);
  return colEl ? colEl.querySelector('.cards-list') : null;
}

function updateColumnCount(columnId) {
  const colEl = getColumnEl(columnId);
  if (!colEl) return;
  const count = colEl.querySelectorAll('.card').length;
  const countEl = colEl.querySelector('.card-count');
  if (countEl) countEl.textContent = count;
}

function updateAllColumnCounts() {
  document.querySelectorAll('.column').forEach(col => {
    const columnId = col.dataset.columnId;
    updateColumnCount(columnId);
  });
}

// --- Rendering ---
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
  header.innerHTML = `
    <span>${escapeHtml(column.title)}</span>
    <span class="card-count">${column.cards.length}</span>
  `;
  colEl.appendChild(header);

  // Cards list
  const cardsList = document.createElement('div');
  cardsList.className = 'cards-list';
  cardsList.dataset.columnId = column.id;

  // Sort cards by position before rendering
  const sortedCards = [...column.cards].sort((a, b) => a.position - b.position);
  for (const card of sortedCards) {
    cardsList.appendChild(createCardElement(card));
  }

  colEl.appendChild(cardsList);

  // Add card form
  const form = document.createElement('div');
  form.className = 'add-card-form';
  form.innerHTML = `
    <textarea class="add-card-input" placeholder="Enter a title for this card..." rows="1"></textarea>
    <button class="add-card-btn">Add a card</button>
    <div class="add-card-cancel">Press ESC to cancel</div>
  `;
  colEl.appendChild(form);

  // Form handlers
  const input = form.querySelector('.add-card-input');
  const addBtn = form.querySelector('.add-card-btn');
  const cancelBtn = form.querySelector('.add-card-cancel');

  addBtn.addEventListener('click', () => {
    const text = input.value.trim();
    if (text) {
      handleCreateCard(column.id, text, cardsList, input);
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = input.value.trim();
      if (text) {
        handleCreateCard(column.id, text, cardsList, input);
      }
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

  // Drag events
  cardEl.addEventListener('dragstart', handleDragStart);
  cardEl.addEventListener('dragend', handleDragEnd);

  return cardEl;
}

// --- Card Creation ---
async function handleCreateCard(columnId, text, cardsList, input) {
  // Optimistic: create card element immediately at the end
  const tempId = 'temp-' + Date.now();
  const cardEl = createCardElement({ id: tempId, text, position: Infinity });
  cardsList.appendChild(cardEl);
  updateColumnCount(columnId);

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
    updateColumnCount(columnId);
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
  e.currentTarget.classList.remove('dragging');
  draggedCardId = null;
  draggedCardEl = null;

  // Remove placeholder
  if (placeholder && placeholder.parentNode) {
    placeholder.parentNode.removeChild(placeholder);
  }
  placeholder = null;

  // Remove drop indicators from all cards
  document.querySelectorAll('.card').forEach(c => {
    c.classList.remove('drop-above', 'drop-below');
  });
}

// Set up drop zones on the board
boardEl.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  if (!draggedCardEl) return;

  // Find the cards list the user is hovering over
  const cardsList = findCardsListForDrop(e.target);
  
  // Remove all indicators
  document.querySelectorAll('.card').forEach(c => {
    c.classList.remove('drop-above', 'drop-below');
  });

  if (!cardsList) return;

  // Only consider cards in this column for drop targeting
  const columnCards = [...cardsList.querySelectorAll('.card:not(.dragging)')];
  
  // Find closest card in this column to drop position
  const target = getClosestCard(columnCards, e.clientY);

  if (target) {
    const rect = target.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (e.clientY < midY) {
      target.classList.add('drop-above');
    } else {
      target.classList.add('drop-below');
    }
  }

  // Move placeholder to visual position
  if (placeholder) {
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
});

boardEl.addEventListener('drop', async (e) => {
  e.preventDefault();

  if (!draggedCardId || !draggedCardEl) return;

  const cardsList = findCardsListForDrop(e.target);
  if (!cardsList) return;

  const targetColumnId = cardsList.dataset.columnId;

  // Only consider cards in this column for positioning
  const columnCards = [...cardsList.querySelectorAll('.card:not(.dragging)')];
  const target = getClosestCard(columnCards, e.clientY);

  // Calculate before and after IDs for the move
  let beforeId = null;
  let afterId = null;

  if (target) {
    const rect = target.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (e.clientY < midY) {
      // Insert before target
      beforeId = target.dataset.cardId;
      // Find the card immediately before target in DOM (which is after in position order)
      const prevSibling = target.previousElementSibling;
      if (prevSibling && prevSibling.classList.contains('card')) {
        afterId = prevSibling.dataset.cardId;
      }
    } else {
      // Insert after target
      afterId = target.dataset.cardId;
      // Find the card immediately after target in DOM (which is before in position order)
      const nextSibling = target.nextElementSibling;
      if (nextSibling && nextSibling.classList.contains('card')) {
        beforeId = nextSibling.dataset.cardId;
      }
    }
  }

  // Optimistic UI update: move the card in the DOM
  const cardEl = draggedCardEl;
  cardEl.classList.remove('dragging');

  // Remove from old position
  cardEl.remove();

  // Insert at new position
  if (placeholder && placeholder.parentNode === cardsList) {
    cardsList.insertBefore(cardEl, placeholder);
  } else {
    cardsList.appendChild(cardEl);
  }

  // Update column counts
  updateAllColumnCounts();

  // Clear drop indicators
  document.querySelectorAll('.card').forEach(c => {
    c.classList.remove('drop-above', 'drop-below');
  });

  if (placeholder && placeholder.parentNode) {
    placeholder.parentNode.removeChild(placeholder);
  }
  placeholder = null;

  // Send to server
  const cardId = draggedCardId;
  draggedCardId = null;
  draggedCardEl = null;

  try {
    const serverCard = await moveCard(cardId, targetColumnId, beforeId, afterId);
    // Reconcile: update position data in DOM
    if (cardEl) {
      cardEl.dataset.position = serverCard.position;
    }
  } catch (err) {
    console.error('Failed to move card:', err);
    // Server will broadcast correct state via SSE for reconciliation
  }
});

function getClosestCard(cardEls, y) {
  if (cardEls.length === 0) return null;

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
  // Try to find a cards-list directly
  const el = target.closest('.cards-list');
  if (el) return el;

  // Try to find a cards-list in the column
  const column = target.closest('.column');
  if (column) {
    return column.querySelector('.cards-list');
  }

  // If dropping directly on the board, find the nearest column
  if (target === boardEl || target.closest('.board') === boardEl) {
    const firstColumn = boardEl.querySelector('.column');
    if (firstColumn) {
      return firstColumn.querySelector('.cards-list');
    }
  }

  return null;
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
    // EventSource will auto-reconnect, but track it
    reconnectTimer = setTimeout(connectSSE, 3000);
  };

  // Handle create events
  sse.addEventListener('create', (e) => {
    const data = JSON.parse(e.data);
    const { card, columnId } = data;

    const cardsList = getCardsListEl(columnId);
    if (!cardsList) return;

    // Check if card already exists (avoid duplicates)
    const existing = getCardEl(card.id);
    if (existing) {
      // Move it to correct position in the column
      existing.remove();
    }

    const cardEl = createCardElement(card);
    cardsList.appendChild(cardEl);
    updateColumnCount(columnId);
  });

  // Handle move events
  sse.addEventListener('move', (e) => {
    const data = JSON.parse(e.data);
    const { card, columnId, oldColumnId } = data;

    // Remove card from wherever it currently is
    const cardEl = getCardEl(card.id);
    if (cardEl) {
      cardEl.remove();
    }

    // Add card to new column, respecting order
    const targetCardsList = getCardsListEl(columnId);
    if (!targetCardsList) return;

    // Find where to insert based on position
    const existingCards = [...targetCardsList.querySelectorAll('.card')];
    let inserted = false;
    for (const existing of existingCards) {
      if (parseFloat(existing.dataset.position) > card.position) {
        targetCardsList.insertBefore(createCardElement(card), existing);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      targetCardsList.appendChild(createCardElement(card));
    }

    updateColumnCount(columnId);
    if (oldColumnId && oldColumnId !== columnId) {
      updateColumnCount(oldColumnId);
    }
  });

  // Handle delete events
  sse.addEventListener('delete', (e) => {
    const data = JSON.parse(e.data);
    const { cardId, columnId } = data;

    const cardEl = getCardEl(cardId);
    if (cardEl) {
      cardEl.remove();
      updateColumnCount(columnId);
    }
  });

  // Handle renormalize events
  sse.addEventListener('renormalize', (e) => {
    const data = JSON.parse(e.data);
    const { columnId, cards } = data;

    const cardsList = getCardsListEl(columnId);
    if (!cardsList) return;

    // Rebuild the cards list with authoritative order
    cardsList.innerHTML = '';
    for (const card of cards) {
      cardsList.appendChild(createCardElement(card));
    }
    updateColumnCount(columnId);
  });
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

const API_BASE = '/api';

// ─── State ──────────────────────────────────────────────────────
let boardState = []; // { id, title, cards: [{ id, text, position }] }
const cardElements = new Map(); // cardId -> DOM element

// ─── Initial Board Load ────────────────────────────────────────
async function loadBoard() {
  const res = await fetch(`${API_BASE}/board`);
  boardState = await res.json();
  renderBoard();
}

// ─── Render Board ──────────────────────────────────────────────
function renderBoard() {
  const boardEl = document.getElementById('board');
  boardEl.innerHTML = '';

  for (const column of boardState) {
    const colEl = createColumnElement(column);
    boardEl.appendChild(colEl);
  }
}

function createColumnElement(column) {
  const colEl = document.createElement('div');
  colEl.className = 'column';
  colEl.dataset.columnId = column.id;

  // Title
  const titleEl = document.createElement('div');
  titleEl.className = 'column-title';
  titleEl.textContent = column.title;
  colEl.appendChild(titleEl);

  // Cards list
  const cardsListEl = document.createElement('div');
  cardsListEl.className = 'cards-list';
  cardsListEl.dataset.columnId = column.id;

  // Sort cards by position
  const sortedCards = [...column.cards].sort((a, b) => a.position - b.position);

  for (const card of sortedCards) {
    const cardEl = createCardElement(card);
    cardsListEl.appendChild(cardEl);
    cardElements.set(card.id, cardEl);
  }

  colEl.appendChild(cardsListEl);

  // Add card form
  const formEl = document.createElement('div');
  formEl.className = 'add-card-form';

  const inputEl = document.createElement('input');
  inputEl.type = 'text';
  inputEl.placeholder = 'Add a card...';
  inputEl.dataset.columnId = column.id;

  const btnEl = document.createElement('button');
  btnEl.textContent = '+';
  btnEl.addEventListener('click', () => addCard(column.id, inputEl.value));

  formEl.appendChild(inputEl);
  formEl.appendChild(btnEl);
  colEl.appendChild(formEl);

  // Drop zone events for the cards-list
  setupDropZone(cardsListEl, column.id);

  return colEl;
}

function createCardElement(card) {
  const cardEl = document.createElement('div');
  cardEl.className = 'card';
  cardEl.draggable = true;
  cardEl.dataset.cardId = card.id;

  // Determine which column this card belongs to
  const colId = findColumnForCard(card.id);
  cardEl.dataset.columnId = colId || '';

  const textEl = document.createElement('div');
  textEl.className = 'card-text';
  textEl.textContent = card.text;

  cardEl.appendChild(textEl);

  // Drag events
  cardEl.addEventListener('dragstart', handleDragStart);
  cardEl.addEventListener('dragend', handleDragEnd);

  return cardEl;
}

function findColumnForCard(cardId) {
  for (const col of boardState) {
    if (col.cards.some(c => c.id === cardId)) {
      return col.id;
    }
  }
  return null;
}

// ─── Drag and Drop Handlers ────────────────────────────────────
let draggedCardId = null;
let dragIndicator = null;

function handleDragStart(e) {
  draggedCardId = e.target.dataset.cardId;
  e.target.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', draggedCardId);

  // Create drag indicator
  dragIndicator = document.createElement('div');
  dragIndicator.className = 'drop-indicator';
  dragIndicator.style.display = 'none';
}

function handleDragEnd(e) {
  e.target.classList.remove('dragging');
  if (dragIndicator && dragIndicator.parentNode) {
    dragIndicator.parentNode.removeChild(dragIndicator);
  }
  draggedCardId = null;

  // Remove all drag-over classes
  document.querySelectorAll('.column.drag-over').forEach(el => {
    el.classList.remove('drag-over');
  });
}

function setupDropZone(cardsListEl, columnId) {
  cardsListEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const columnEl = cardsListEl.closest('.column');
    if (columnEl) columnEl.classList.add('drag-over');

    // Find the card below the cursor
    const afterCard = getCardBelowCursor(cardsListEl, e.clientY);
    showIndicator(cardsListEl, afterCard);
  });

  cardsListEl.addEventListener('dragleave', (e) => {
    if (!cardsListEl.contains(e.relatedTarget)) {
      removeIndicator();
      const columnEl = cardsListEl.closest('.column');
      if (columnEl) columnEl.classList.remove('drag-over');
    }
  });

  cardsListEl.addEventListener('drop', (e) => {
    e.preventDefault();
    const columnEl = cardsListEl.closest('.column');
    if (columnEl) columnEl.classList.remove('drag-over');

    const targetColumnId = cardsListEl.dataset.columnId;
    const afterCard = getCardBelowCursor(cardsListEl, e.clientY);

    moveCard(draggedCardId, targetColumnId, null, afterCard ? afterCard.id : null);
  });
}

function getCardBelowCursor(listEl, y) {
  const cards = [...listEl.querySelectorAll('.card:not(.dragging)')];

  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    if (y < rect.top + rect.height / 2) {
      return card;
    }
  }

  // If no card found above, check after the last one
  if (cards.length > 0) {
    const lastCard = cards[cards.length - 1];
    const lastRect = lastCard.getBoundingClientRect();
    if (y > lastRect.bottom) {
      return null; // Drop at end
    }
  }

  return cards[0] || null;
}

function showIndicator(listEl, afterCard) {
  removeIndicator();
  if (!dragIndicator) return;

  dragIndicator.style.display = 'block';

  if (afterCard) {
    listEl.insertBefore(dragIndicator, afterCard);
  } else {
    listEl.appendChild(dragIndicator);
  }
}

function removeIndicator() {
  if (dragIndicator && dragIndicator.parentNode) {
    dragIndicator.parentNode.removeChild(dragIndicator);
  }
}

// ─── Card Operations ───────────────────────────────────────────
async function moveCard(cardId, columnId, beforeId, afterId) {
  if (!cardId || !columnId) return;

  try {
    const res = await fetch(`${API_BASE}/cards/${cardId}/move`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columnId, beforeId, afterId })
    });

    if (!res.ok) {
      throw new Error(`Move failed: ${res.statusText}`);
    }

    const canonicalCard = await res.json();
    reconcileWithServer(cardId, canonicalCard);
  } catch (err) {
    console.error('Move error:', err);
    // Revert optimistic update on failure
    loadBoard();
  }
}

async function addCard(columnId, text) {
  if (!text.trim()) return;

  try {
    const res = await fetch(`${API_BASE}/cards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columnId, text: text.trim() })
    });

    if (!res.ok) {
      throw new Error(`Create failed: ${res.statusText}`);
    }

    const card = await res.json();
    // Optimistically add the card to the UI
    optimisticAddCard(columnId, card);
  } catch (err) {
    console.error('Create card error:', err);
    loadBoard();
  }
}

function optimisticAddCard(columnId, card) {
  const column = boardState.find(c => c.id === columnId);
  if (!column) return;

  // Update state
  column.cards.push(card);

  // Render the new card
  const cardsListEl = document.querySelector(`.cards-list[data-column-id="${columnId}"]`);
  if (cardsListEl) {
    const cardEl = createCardElement(card);
    cardsListEl.appendChild(cardEl);
    cardElements.set(card.id, cardEl);
  }
}

// ─── Reconciliation ────────────────────────────────────────────
function reconcileWithServer(cardId, canonicalCard) {
  // Update the card in our state
  let found = false;
  for (const col of boardState) {
    const idx = col.cards.findIndex(c => c.id === cardId);
    if (idx !== -1) {
      col.cards[idx] = { ...col.cards[idx], position: canonicalCard.position };
      found = true;
      break;
    }
  }

  // If the card was moved to a new column, add it there
  if (!found) {
    let targetCol = boardState.find(c => c.id === canonicalCard.columnId);
    if (!targetCol) {
      // Column not found in state - shouldn't happen but handle gracefully
      return;
    }
    targetCol.cards.push({ id: cardId, position: canonicalCard.position });
  }

  // Sort each column by position
  for (const col of boardState) {
    col.cards.sort((a, b) => a.position - b.position);
  }

  // Re-render the entire board to ensure consistency
  renderBoard();
}

function reconcileFullBoard(newBoardState) {
  boardState = newBoardState;
  cardElements.clear();
  renderBoard();
}

// ─── SSE Connection ────────────────────────────────────────────
let eventSource = null;

function connectSSE() {
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource(`${API_BASE}/stream`);

  eventSource.addEventListener('board-initial', (e) => {
    const data = JSON.parse(e.data);
    reconcileFullBoard(data);
  });

  eventSource.addEventListener('card-created', (e) => {
    const card = JSON.parse(e.data);
    // Add to state
    const column = boardState.find(c => c.id === card.columnId);
    if (column) {
      column.cards.push(card);
      // Sort by position
      column.cards.sort((a, b) => a.position - b.position);
      renderBoard();
    }
  });

  eventSource.addEventListener('card-moved', (e) => {
    const card = JSON.parse(e.data);
    reconcileWithServer(card.id, card);
  });

  eventSource.addEventListener('column-renormalized', (e) => {
    const data = JSON.parse(e.data);
    // Update the column's cards in state
    const column = boardState.find(c => c.id === data.columnId);
    if (column && data.cards) {
      for (const card of data.cards) {
        const existing = column.cards.find(c => c.id === card.id);
        if (existing) {
          existing.position = card.position;
        }
      }
      // Sort by position
      column.cards.sort((a, b) => a.position - b.position);
      renderBoard();
    }
  });

  eventSource.onerror = (err) => {
    console.error('SSE connection error:', err);
    // Reconnect after a delay
    setTimeout(() => connectSSE(), 3000);
  };
}

// ─── Initialize ────────────────────────────────────────────────
async function init() {
  await loadBoard();
  connectSSE();
}

init();

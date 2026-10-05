// ============================================================
// Kanban Board - Frontend Application
// ============================================================

// --- State ---
let boardState = [];          // [{ column, cards: [] }]
let sse = null;               // EventSource for real-time updates
let draggedCardId = null;     // Currently dragged card ID
let optimisticState = null;   // Track optimistic move for reconciliation

// --- API Helpers ---
const API_BASE = '/api';

async function fetchBoard() {
  const res = await fetch(`${API_BASE}/board`);
  if (!res.ok) throw new Error('Failed to fetch board');
  return res.json();
}

async function createCard(columnId, text) {
  const res = await fetch(`${API_BASE}/cards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ column_id: columnId, text })
  });
  if (!res.ok) throw new Error('Failed to create card');
  return res.json();
}

async function moveCard(cardId, columnId, beforeId, afterId) {
  const res = await fetch(`${API_BASE}/cards/${cardId}/move`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ column_id: columnId, before_id: beforeId, after_id: afterId })
  });
  if (!res.ok) throw new Error('Failed to move card');
  return res.json();
}

// --- Rendering ---
function renderBoard() {
  const boardEl = document.getElementById('board');
  boardEl.innerHTML = '';

  for (const { column, cards } of boardState) {
    const columnEl = createColumnElement(column, cards);
    boardEl.appendChild(columnEl);
  }

  setupDropZones();
}

function createColumnElement(column, cards) {
  const colEl = document.createElement('div');
  colEl.className = 'column';
  colEl.dataset.columnId = column.id;

  // Header
  const header = document.createElement('div');
  header.className = 'column-header';
  header.innerHTML = `
    <span>${escapeHtml(column.title)}</span>
    <span class="card-count">${cards.length}</span>
  `;
  colEl.appendChild(header);

  // Cards container
  const cardsContainer = document.createElement('div');
  cardsContainer.className = 'cards-container';
  cardsContainer.dataset.columnId = column.id;

  for (const card of cards) {
    const cardEl = createCardElement(card);
    cardsContainer.appendChild(cardEl);
  }

  colEl.appendChild(cardsContainer);

  // Add card form
  const form = document.createElement('div');
  form.className = 'add-card-form';
  form.innerHTML = `
    <textarea class="add-card-input" placeholder="Enter a title for this card…" rows="1"></textarea>
    <div class="add-card-actions" style="display:none;">
      <button class="add-card-btn">Add card</button>
      <button class="add-card-cancel">✕</button>
    </div>
  `;

  const input = form.querySelector('.add-card-input');
  const actions = form.querySelector('.add-card-actions');
  const addBtn = form.querySelector('.add-card-btn');
  const cancelBtn = form.querySelector('.add-card-cancel');

  input.addEventListener('focus', () => {
    actions.style.display = 'flex';
  });

  cancelBtn.addEventListener('click', () => {
    input.value = '';
    actions.style.display = 'none';
    input.blur();
  });

  addBtn.addEventListener('click', () => {
    const text = input.value.trim();
    if (text) {
      input.value = '';
      actions.style.display = 'none';
      createCard(column.id, text);
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = input.value.trim();
      if (text) {
        input.value = '';
        actions.style.display = 'none';
        createCard(column.id, text);
      }
    }
    if (e.key === 'Escape') {
      input.value = '';
      actions.style.display = 'none';
      input.blur();
    }
  });

  colEl.appendChild(form);

  return colEl;
}

function createCardElement(card) {
  const cardEl = document.createElement('div');
  cardEl.className = 'card';
  cardEl.draggable = true;
  cardEl.dataset.cardId = card.id;
  cardEl.textContent = card.text;

  // Drag events
  cardEl.addEventListener('dragstart', handleDragStart);
  cardEl.addEventListener('dragend', handleDragEnd);

  return cardEl;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// --- Drag and Drop ---
function handleDragStart(e) {
  draggedCardId = e.target.dataset.cardId;
  e.target.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', draggedCardId);
}

function handleDragEnd(e) {
  e.target.classList.remove('dragging');
  draggedCardId = null;

  // Remove all placeholders and drag-over states
  document.querySelectorAll('.drag-placeholder').forEach(el => el.remove());
  document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));

  // If we have an optimistic state, send the move request
  if (optimisticState) {
    const { cardId, columnId, beforeId, afterId } = optimisticState;
    optimisticState = null;
    moveCard(cardId, columnId, beforeId, afterId)
      .then(result => {
        // Reconcile with server state
        reconcileWithServer(result);
      })
      .catch(err => {
        console.error('Move failed:', err);
        // Re-render to restore correct state
        fetchBoard().then(renderBoard).catch(() => {});
      });
  }
}

function setupDropZones() {
  const containers = document.querySelectorAll('.cards-container');

  containers.forEach(container => {
    container.addEventListener('dragover', handleDragOver);
    container.addEventListener('dragenter', handleDragEnter);
    container.addEventListener('dragleave', handleDragLeave);
    container.addEventListener('drop', handleDrop);
  });
}

function handleDragEnter(e) {
  e.preventDefault();
  e.currentTarget.classList.add('drag-over');
}

function handleDragLeave(e) {
  // Only remove if we actually left the container
  if (!e.currentTarget.contains(e.relatedTarget)) {
    e.currentTarget.classList.remove('drag-over');
  }
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  const container = e.currentTarget;
  const afterElement = getDragAfterElement(container, e.clientY);

  // Remove existing placeholder
  document.querySelectorAll('.drag-placeholder').forEach(el => el.remove());

  // Create and position placeholder
  const placeholder = document.createElement('div');
  placeholder.className = 'drag-placeholder';

  if (afterElement == null) {
    container.appendChild(placeholder);
  } else {
    container.insertBefore(placeholder, afterElement);
  }
}

function handleDrop(e) {
  e.preventDefault();
  const container = e.currentTarget;
  const columnId = container.dataset.columnId;

  // Remove placeholder and drag-over state
  document.querySelectorAll('.drag-placeholder').forEach(el => el.remove());
  document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));

  if (!draggedCardId) return;

  // Determine position: find the card we dropped before/after
  const afterElement = getDragAfterElement(container, e.clientY);

  let beforeId = null;
  let afterId = null;

  if (afterElement) {
    // We're dropping before this element
    beforeId = afterElement.dataset.cardId;
  } else {
    // We're dropping at the end - find the last card (not the dragged one)
    const cards = container.querySelectorAll('.card:not(.dragging)');
    if (cards.length > 0) {
      afterId = cards[cards.length - 1].dataset.cardId;
    }
  }

  // Optimistic update: move the card in the DOM
  const cardEl = document.querySelector(`.card[data-card-id="${draggedCardId}"]`);
  if (cardEl) {
    cardEl.classList.remove('dragging');
    // Remove from current location and insert at new location
    if (afterElement) {
      container.insertBefore(cardEl, afterElement);
    } else {
      container.appendChild(cardEl);
    }
  }

  // Store optimistic state for reconciliation
  optimisticState = {
    cardId: draggedCardId,
    columnId,
    beforeId,
    afterId
  };

  // Update card counts
  updateCardCounts();
}

function getDragAfterElement(container, y) {
  // Get all cards in this container (excluding the dragged one and placeholders)
  const cards = [...container.querySelectorAll('.card:not(.dragging)')];

  let closest = null;
  let closestOffset = Number.NEGATIVE_INFINITY;

  cards.forEach(card => {
    const box = card.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;

    if (offset < 0 && offset > closestOffset) {
      closestOffset = offset;
      closest = card;
    }
  });

  return closest;
}

function updateCardCounts() {
  document.querySelectorAll('.column').forEach(col => {
    const cardCount = col.querySelectorAll('.card').length;
    const countEl = col.querySelector('.card-count');
    if (countEl) {
      countEl.textContent = cardCount;
    }
  });
}

// --- Reconciliation ---
function reconcileWithServer(result) {
  const { card, card_order, old_column_card_order } = result;

  // Update the card's text if it changed
  const cardEl = document.querySelector(`.card[data-card-id="${card.id}"]`);
  if (cardEl) {
    cardEl.textContent = card.text;
  }

  // Reorder cards in the target column according to server order
  const targetColumn = document.querySelector(`.column[data-column-id="${card.column_id}"]`);
  if (targetColumn) {
    const container = targetColumn.querySelector('.cards-container');
    if (container) {
      reorderContainer(container, card_order);
    }
  }

  // Reorder cards in the old column if it changed
  if (old_column_card_order && result.old_column_id && result.old_column_id !== card.column_id) {
    const oldColumn = document.querySelector(`.column[data-column-id="${result.old_column_id}"]`);
    if (oldColumn) {
      const container = oldColumn.querySelector('.cards-container');
      if (container) {
        reorderContainer(container, old_column_card_order);
      }
    }
  }

  updateCardCounts();
}

function reorderContainer(container, cardOrder) {
  // Build a map of existing card elements
  const existingCards = {};
  const currentCards = container.querySelectorAll('.card');
  currentCards.forEach(card => {
    existingCards[card.dataset.cardId] = card;
  });

  // Remove cards not in the order (they moved to another column)
  currentCards.forEach(card => {
    if (!cardOrder.includes(card.dataset.cardId)) {
      card.remove();
    }
  });

  // Reorder remaining cards according to server order
  const fragment = document.createDocumentFragment();
  cardOrder.forEach(cardId => {
    if (existingCards[cardId]) {
      fragment.appendChild(existingCards[cardId]);
    }
  });
  container.appendChild(fragment);
}

// --- SSE Real-time Updates ---
function connectSSE() {
  const statusEl = document.getElementById('status');

  // Disconnect existing connection
  if (sse) {
    sse.close();
  }

  sse = new EventSource(`${API_BASE}/stream`);

  sse.onopen = () => {
    statusEl.innerHTML = '<span class="connected">●</span> Connected';
  };

  sse.onerror = (e) => {
    statusEl.innerHTML = '<span class="disconnected">●</span> Disconnected — reconnecting…';
    // EventSource will automatically reconnect
  };

  // Card created event
  sse.addEventListener('cardCreated', (e) => {
    const data = JSON.parse(e.data);
    handleCardCreated(data);
  });

  // Card moved event
  sse.addEventListener('cardMoved', (e) => {
    const data = JSON.parse(e.data);
    handleCardMoved(data);
  });

  // Column renormalized event
  sse.addEventListener('columnRenormalized', (e) => {
    const data = JSON.parse(e.data);
    handleColumnRenormalized(data);
  });
}

function handleCardCreated(data) {
  const { card, column_id } = data;

  // Don't update if this is our own optimistic update (will be reconciled)
  if (optimisticState && optimisticState.cardId === card.id) {
    return;
  }

  // Find the column
  const column = document.querySelector(`.column[data-column-id="${column_id}"]`);
  if (!column) {
    // Board state might be stale, re-render
    fetchBoard().then(renderBoard).catch(() => connectSSE());
    return;
  }

  const container = column.querySelector('.cards-container');
  if (!container) return;

  // Create and append the new card at the end
  const cardEl = createCardElement(card);
  container.appendChild(cardEl);

  updateCardCounts();
}

function handleCardMoved(data) {
  const { card, column_id, old_column_id, card_order, old_column_card_order } = data;

  // Don't update if this is our own optimistic update
  if (optimisticState && optimisticState.cardId === card.id) {
    return;
  }

  // Remove the card from wherever it currently is
  const existingCard = document.querySelector(`.card[data-card-id="${card.id}"]`);
  if (existingCard) {
    existingCard.remove();
  }

  // Reorder the target column
  const targetColumn = document.querySelector(`.column[data-column-id="${column_id}"]`);
  if (targetColumn) {
    const container = targetColumn.querySelector('.cards-container');
    if (container) {
      // First reorder existing cards
      reorderContainer(container, card_order);

      // If the card doesn't exist in the DOM yet (moved from another column), add it
      if (!document.querySelector(`.card[data-card-id="${card.id}"]`)) {
        const cardEl = createCardElement(card);
        // Insert at correct position based on card_order
        const idx = card_order.indexOf(card.id);
        if (idx >= 0) {
          const cards = container.querySelectorAll('.card');
          if (idx < cards.length) {
            container.insertBefore(cardEl, cards[idx]);
          } else {
            container.appendChild(cardEl);
          }
        } else {
          container.appendChild(cardEl);
        }
      }
    }
  }

  // Reorder the old column if it changed
  if (old_column_card_order && old_column_id && old_column_id !== column_id) {
    const oldColumn = document.querySelector(`.column[data-column-id="${old_column_id}"]`);
    if (oldColumn) {
      const container = oldColumn.querySelector('.cards-container');
      if (container) {
        reorderContainer(container, old_column_card_order);
      }
    }
  }

  updateCardCounts();
}

function handleColumnRenormalized(data) {
  const { column_id, card_order } = data;

  const column = document.querySelector(`.column[data-column-id="${column_id}"]`);
  if (column) {
    const container = column.querySelector('.cards-container');
    if (container) {
      reorderContainer(container, card_order);
    }
  }

  updateCardCounts();
}

// --- Initialization ---
async function init() {
  try {
    boardState = await fetchBoard();
    renderBoard();
    connectSSE();
  } catch (err) {
    console.error('Failed to initialize board:', err);
    document.getElementById('status').innerHTML = '<span class="disconnected">●</span> Failed to connect to server';
    // Retry after a delay
    setTimeout(init, 3000);
  }
}

init();

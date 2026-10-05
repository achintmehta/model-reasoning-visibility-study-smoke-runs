// ============================================================
// State Management
// ============================================================

/**
 * Board state: array of columns, each with an ordered list of cards.
 */
let boardState = [];

// Track which card is being dragged
let draggedCardId = null;
let draggedCardElement = null;
let dragPlaceholder = null;

// SSE connection
let eventSource = null;

// ============================================================
// API Functions
// ============================================================

/**
 * Fetch the full board state from the server.
 */
async function fetchBoard() {
  const response = await fetch('/api/board');
  if (!response.ok) throw new Error('Failed to fetch board');
  return response.json();
}

/**
 * Create a card via POST /api/cards
 */
async function createCard(columnId, text) {
  const response = await fetch('/api/cards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ column_id: columnId, text })
  });
  if (!response.ok) throw new Error('Failed to create card');
  return response.json();
}

/**
 * Move a card via PATCH /api/cards/:id/move
 */
async function moveCard(cardId, columnId, beforeId, afterId) {
  const response = await fetch(`/api/cards/${cardId}/move`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ column_id: columnId, before_id: beforeId, after_id: afterId })
  });
  if (!response.ok) throw new Error('Failed to move card');
  return response.json();
}

// ============================================================
// Board State Helpers
// ============================================================

/**
 * Find a column by id.
 */
function findColumn(columnId) {
  return boardState.find(c => c.id === columnId);
}

/**
 * Find a card by id and return { card, column }.
 */
function findCard(cardId) {
  for (const col of boardState) {
    const card = col.cards.find(c => c.id === cardId);
    if (card) return { card, column: col };
  }
  return null;
}

/**
 * Get the card ids in a column in order.
 */
function getColumnCardIds(columnId) {
  const col = findColumn(columnId);
  if (!col) return [];
  return col.cards.map(c => c.id);
}

// ============================================================
// Rendering
// ============================================================

/**
 * Render the full board from state.
 */
function renderBoard() {
  const boardEl = document.getElementById('board');
  boardEl.innerHTML = '';

  for (const column of boardState) {
    const colEl = createColumnElement(column);
    boardEl.appendChild(colEl);
  }

  setupDragAndDrop();
}

/**
 * Create a DOM element for a column.
 */
function createColumnElement(column) {
  const colEl = document.createElement('div');
  colEl.className = 'column';
  colEl.dataset.columnId = column.id;

  // Column header
  const headerEl = document.createElement('div');
  headerEl.className = 'column-header';
  headerEl.textContent = column.title;
  colEl.appendChild(headerEl);

  // Card list container
  const cardListEl = document.createElement('div');
  cardListEl.className = 'card-list';
  cardListEl.dataset.columnId = column.id;

  for (const card of column.cards) {
    const cardEl = createCardElement(card);
    cardListEl.appendChild(cardEl);
  }

  colEl.appendChild(cardListEl);

  // Add card form
  const formEl = createAddCardForm(column.id);
  colEl.appendChild(formEl);

  return colEl;
}

/**
 * Create a DOM element for a card.
 */
function createCardElement(card) {
  const cardEl = document.createElement('div');
  cardEl.className = 'card';
  cardEl.dataset.cardId = card.id;
  cardEl.textContent = card.text;
  return cardEl;
}

/**
 * Create the add-card form for a column.
 */
function createAddCardForm(columnId) {
  const formEl = document.createElement('div');
  formEl.className = 'add-card-form';

  // Initial "Add a card" button
  const initialBtn = document.createElement('button');
  initialBtn.className = 'add-card-btn';
  initialBtn.textContent = '+ Add a card';
  initialBtn.addEventListener('click', () => {
    showInput(formEl, columnId);
  });

  formEl.appendChild(initialBtn);
  return formEl;
}

/**
 * Show the text input in the add-card form.
 */
function showInput(formEl, columnId) {
  formEl.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'add-card-input-wrapper';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'add-card-input';
  input.placeholder = 'Enter a title for this card...';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'add-card-cancel';
  cancelBtn.textContent = '×';
  cancelBtn.addEventListener('click', () => {
    // Restore initial button
    formEl.innerHTML = '';
    const initialBtn = document.createElement('button');
    initialBtn.className = 'add-card-btn';
    initialBtn.textContent = '+ Add a card';
    initialBtn.addEventListener('click', () => showInput(formEl, columnId));
    formEl.appendChild(initialBtn);
  });

  wrapper.appendChild(input);
  wrapper.appendChild(cancelBtn);
  formEl.appendChild(wrapper);

  input.focus();

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) {
      addCard(columnId, input.value.trim(), formEl);
    } else if (e.key === 'Escape') {
      cancelBtn.click();
    }
  });

  input.addEventListener('blur', () => {
    if (!input.value.trim()) {
      cancelBtn.click();
    }
  });
}

/**
 * Submit a new card. Optimistically add to state, then send to server.
 */
async function addCard(columnId, text, formEl) {
  try {
    const card = await createCard(columnId, text);
    // The server will broadcast the card via SSE; we update on receipt.
    // But also optimistically add it:
    optimisticAddCard(card);
  } catch (err) {
    console.error('Failed to create card:', err);
  }

  // Reset form
  formEl.innerHTML = '';
  const initialBtn = document.createElement('button');
  initialBtn.className = 'add-card-btn';
  initialBtn.textContent = '+ Add a card';
  initialBtn.addEventListener('click', () => showInput(formEl, columnId));
  formEl.appendChild(initialBtn);
}

/**
 * Optimistically add a card to the board state and DOM.
 */
function optimisticAddCard(card) {
  const col = findColumn(card.column_id);
  if (!col) return;

  // Add to state (at end since server places at end)
  col.cards.push({ ...card });

  // Update DOM: find the column's card-list and append
  const cardListEl = document.querySelector(`.card-list[data-column-id="${card.column_id}"]`);
  if (cardListEl) {
    const cardEl = createCardElement(card);
    cardListEl.appendChild(cardEl);
    setupDragAndDrop();
  }
}

// ============================================================
// Drag and Drop
// ============================================================

/**
 * Set up drag-and-drop event listeners on all cards.
 */
function setupDragAndDrop() {
  // Card drag events
  document.querySelectorAll('.card').forEach(cardEl => {
    cardEl.addEventListener('dragstart', handleDragStart);
    cardEl.addEventListener('dragend', handleDragEnd);
  });

  // Drop zone events on card lists
  document.querySelectorAll('.card-list').forEach(listEl => {
    listEl.addEventListener('dragover', handleDragOver);
    listEl.addEventListener('dragenter', handleDragEnter);
    listEl.addEventListener('dragleave', handleDragLeave);
    listEl.addEventListener('drop', handleDrop);
  });
}

function handleDragStart(e) {
  draggedCardId = e.target.dataset.cardId;
  draggedCardElement = e.target;
  e.target.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', draggedCardId);

  // Create placeholder
  dragPlaceholder = document.createElement('div');
  dragPlaceholder.className = 'card drag-placeholder';
}

function handleDragEnd(e) {
  e.target.classList.remove('dragging');
  if (dragPlaceholder && dragPlaceholder.parentNode) {
    dragPlaceholder.parentNode.removeChild(dragPlaceholder);
  }
  draggedCardId = null;
  draggedCardElement = null;
  dragPlaceholder = null;

  // Remove all drag-over styles
  document.querySelectorAll('.card-list.drag-over').forEach(el => {
    el.classList.remove('drag-over');
  });
}

function handleDragEnter(e) {
  e.preventDefault();
  const listEl = e.currentTarget;
  listEl.classList.add('drag-over');
}

function handleDragLeave(e) {
  // Only remove if we're actually leaving the card-list (not entering a child)
  const listEl = e.currentTarget;
  const rect = listEl.getBoundingClientRect();
  const x = e.clientX;
  const y = e.clientY;

  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
    listEl.classList.remove('drag-over');
  }
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  const listEl = e.currentTarget;
  const cardId = draggedCardId;
  if (!cardId) return;

  // Find the card we're hovering over
  const cards = [...listEl.querySelectorAll('.card:not(.dragging)')];
  const afterCard = getHoveredCard(listEl, e.clientY);

  // Remove existing placeholder
  if (dragPlaceholder && dragPlaceholder.parentNode) {
    dragPlaceholder.parentNode.removeChild(dragPlaceholder);
  }

  // Insert placeholder at the right position
  dragPlaceholder = document.createElement('div');
  dragPlaceholder.className = 'card drag-placeholder';

  if (afterCard) {
    afterCard.after(dragPlaceholder);
  } else {
    listEl.appendChild(dragPlaceholder);
  }
}

/**
 * Find the card element being hovered over.
 */
function getHoveredCard(listEl, y) {
  const cards = [...listEl.querySelectorAll('.card:not(.dragging):not(.drag-placeholder)')];

  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (y < midY) return card;
  }

  // If past all cards, return the last one to insert after it
  return cards.length > 0 ? cards[cards.length - 1] : null;
}

/**
 * Handle drop: compute before/after IDs and send move request.
 */
async function handleDrop(e) {
  e.preventDefault();
  const listEl = e.currentTarget;
  const targetColumnId = listEl.dataset.columnId;
  const cardId = draggedCardId;

  if (!cardId || !targetColumnId) return;

  // Clean up visual state
  document.querySelectorAll('.card-list.drag-over').forEach(el => {
    el.classList.remove('drag-over');
  });
  if (dragPlaceholder && dragPlaceholder.parentNode) {
    dragPlaceholder.parentNode.removeChild(dragPlaceholder);
  }

  // Determine before and after card IDs
  const cards = [...listEl.querySelectorAll('.card:not(.dragging):not(.drag-placeholder)')];
  const dropTarget = getDropTarget(listEl, e.clientY);

  let beforeId = null;
  let afterId = null;

  if (dropTarget && dropTarget.index >= 0) {
    // Insert before the target card
    beforeId = cards[dropTarget.index]?.id || null;
    afterId = cards[dropTarget.index - 1]?.id || null;
  } else if (cards.length > 0) {
    // Append at end
    afterId = cards[cards.length - 1].id;
  }

  // Optimistically update the DOM
  optimisticMoveCard(cardId, targetColumnId, listEl);

  try {
    // Send to server for authoritative move
    const canonicalCard = await moveCard(cardId, targetColumnId, beforeId, afterId);
    // The SSE event will reconcile the state; we don't need to do anything here
    // because the SSE handler will update the DOM to match canonical state.
  } catch (err) {
    console.error('Failed to move card:', err);
    // Revert optimistic update by re-rendering from state
    renderBoard();
  }

  dragPlaceholder = null;
  draggedCardId = null;
  draggedCardElement = null;
}

/**
 * Get the drop target index. Returns { index, element } or null.
 */
function getDropTarget(listEl, y) {
  const cards = [...listEl.querySelectorAll('.card:not(.dragging):not(.drag-placeholder)')];

  for (let i = 0; i < cards.length; i++) {
    const rect = cards[i].getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (y < midY) {
      return { index: i, element: cards[i] };
    }
  }

  // Drop after all cards
  return { index: cards.length, element: null };
}

/**
 * Optimistically move a card in the DOM.
 */
function optimisticMoveCard(cardId, targetColumnId, targetListEl) {
  // Find the card element
  const cardEl = document.querySelector(`.card[data-card-id="${cardId}"]`);
  if (!cardEl) return;

  // Remove from old position
  cardEl.remove();

  // Determine where to insert in new position
  const cards = [...targetListEl.querySelectorAll('.card:not(.dragging):not(.drag-placeholder)')];
  let insertIndex = cards.length;

  // Find the placeholder position
  if (dragPlaceholder && dragPlaceholder.parentNode === targetListEl) {
    const allChildren = [...targetListEl.children];
    const phIndex = allChildren.indexOf(dragPlaceholder);
    // Count non-placeholder cards before this index
    insertIndex = 0;
    for (let i = 0; i < phIndex; i++) {
      if (allChildren[i].classList.contains('card') && !allChildren[i].classList.contains('drag-placeholder')) {
        insertIndex++;
      }
    }
  }

  // Insert card at the right position
  if (insertIndex >= cards.length) {
    targetListEl.appendChild(cardEl);
  } else {
    cards[insertIndex].before(cardEl);
  }

  // Update state
  const oldResult = findCard(cardId);
  if (oldResult) {
    const oldCol = oldResult.column;
    const idx = oldCol.cards.findIndex(c => c.id === cardId);
    if (idx >= 0) oldCol.cards.splice(idx, 1);

    const targetCol = findColumn(targetColumnId);
    if (targetCol) {
      // Insert at the right position in state
      const stateIdx = insertIndex < targetCol.cards.length ? insertIndex : targetCol.cards.length;
      targetCol.cards.splice(stateIdx, 0, oldResult.card);
    }
  }
}

// ============================================================
// SSE Connection & Event Handling
// ============================================================

/**
 * Connect to the SSE stream and handle events.
 */
function connectSSE() {
  // Close existing connection if any
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource('/api/stream');

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleSSEEvent(data);
    } catch (err) {
      console.error('Error parsing SSE event:', err);
    }
  };

  eventSource.onerror = (err) => {
    console.warn('SSE connection error, reconnecting...', err);
    // EventSource will auto-reconnect
  };
}

/**
 * Handle an incoming SSE event.
 */
function handleSSEEvent(data) {
  switch (data.type) {
    case 'create':
      handleCreateEvent(data.card);
      break;
    case 'move':
      handleMoveEvent(data.card);
      break;
    case 'delete':
      handleDeleteEvent(data.card_id);
      break;
    case 'renormalize':
      handleRenormalizeEvent(data.column_id, data.cards);
      break;
    default:
      console.warn('Unknown SSE event type:', data.type);
  }
}

/**
 * Handle a card creation event from the server.
 */
function handleCreateEvent(card) {
  // Check if we already have this card (from optimistic update)
  const existing = findCard(card.id);

  if (!existing) {
    // New card from another client; add it to state and DOM
    const col = findColumn(card.column_id);
    if (col) {
      // Insert at the correct position based on fractional ordering
      insertCardAtPosition(col, card);
      renderBoard();
    }
  } else if (existing.card.column_id !== card.column_id || Math.abs(existing.card.position - card.position) > 0.01) {
    // Server canonical state differs from our optimistic state; reconcile
    reconcileCard(card);
  }
}

/**
 * Handle a card move event from the server.
 */
function handleMoveEvent(card) {
  const existing = findCard(card.id);

  if (!existing) {
    // Shouldn't happen, but add it anyway
    const col = findColumn(card.column_id);
    if (col) {
      insertCardAtPosition(col, card);
      renderBoard();
    }
  } else {
    // Reconcile: update to canonical server state
    reconcileCard(card);
  }
}

/**
 * Handle a card deletion event.
 */
function handleDeleteEvent(cardId) {
  for (const col of boardState) {
    const idx = col.cards.findIndex(c => c.id === cardId);
    if (idx >= 0) {
      col.cards.splice(idx, 1);
      break;
    }
  }
  renderBoard();
}

/**
 * Handle a column renormalization event.
 */
function handleRenormalizeEvent(columnId, cards) {
  const col = findColumn(columnId);
  if (col) {
    col.cards = cards.map(c => ({ ...c }));
    renderBoard();
  }
}

/**
 * Reconcile a card with the server's canonical state.
 */
function reconcileCard(canonicalCard) {
  // Remove card from its current position in state
  for (const col of boardState) {
    const idx = col.cards.findIndex(c => c.id === canonicalCard.id);
    if (idx >= 0) {
      col.cards.splice(idx, 1);
      break;
    }
  }

  // Add card at the correct position in the target column
  const targetCol = findColumn(canonicalCard.column_id);
  if (targetCol) {
    insertCardAtPosition(targetCol, canonicalCard);
    renderBoard();
  }
}

/**
 * Insert a card into a column's cards array at the correct fractional position.
 */
function insertCardAtPosition(column, card) {
  let inserted = false;
  for (let i = 0; i < column.cards.length; i++) {
    if (column.cards[i].position > card.position) {
      column.cards.splice(i, 0, { ...card });
      inserted = true;
      break;
    }
  }
  if (!inserted) {
    column.cards.push({ ...card });
  }
}

// ============================================================
// Initialization
// ============================================================

async function init() {
  try {
    // Fetch initial board state from server
    boardState = await fetchBoard();

    // Render the board
    renderBoard();

    // Connect to SSE for real-time updates
    connectSSE();

    console.log('Kanban board initialized successfully');
  } catch (err) {
    console.error('Failed to initialize Kanban board:', err);
    document.getElementById('board').innerHTML = `
      <div style="padding: 24px; color: #cf383e;">
        <h2>Failed to load board</h2>
        <p>Please make sure the server is running.</p>
        <p><strong>Error:</strong> ${err.message}</p>
      </div>
    `;
  }
}

// Start the app
init();

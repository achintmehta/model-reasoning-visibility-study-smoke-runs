const API_BASE = '/api';

// State management
let boardState = { columns: {} }; // { columnId: { title, position, cards: { cardId: { id, text, position } } } }

// DOM cache
const domCache = new Map(); // cardId -> DOM element

// ==================== API Functions ====================

async function fetchBoard() {
  const res = await fetch(`${API_BASE}/board`);
  const data = await res.json();
  return data;
}

async function createCard(columnId, text) {
  const res = await fetch(`${API_BASE}/cards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ columnId, text }),
  });
  return res.json();
}

async function moveCard(cardId, { columnId, beforeId, afterId }) {
  const res = await fetch(`${API_BASE}/cards/${cardId}/move`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ columnId, beforeId, afterId }),
  });
  return res.json();
}

// ==================== SSE Connection ====================

function connectSSE() {
  const eventSource = new EventSource(`${API_BASE}/stream`);

  eventSource.addEventListener('connected', () => {
    console.log('SSE connected');
  });

  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleServerEvent(data);
  };

  eventSource.onerror = () => {
    console.error('SSE connection error, reconnecting...');
  };

  return eventSource;
}

function handleServerEvent(data) {
  if (data.type === 'card_created') {
    const { card, columnId } = data;
    if (!boardState.columns[columnId]) {
      boardState.columns[columnId] = { title: '', cards: {} };
    }
    boardState.columns[columnId].cards[card.id] = card;
    renderCard(card, columnId);
  } else if (data.type === 'card_moved') {
    const { card, columnId } = data;
    // Remove from old location
    for (const colId in boardState.columns) {
      if (boardState.columns[colId].cards[card.id]) {
        delete boardState.columns[colId].cards[card.id];
        break;
      }
    }
    // Add to new location
    if (!boardState.columns[columnId]) {
      boardState.columns[columnId] = { title: '', cards: {} };
    }
    boardState.columns[columnId].cards[card.id] = card;
    // Re-render entire board to ensure consistency
    renderBoard();
  } else if (data.type === 'renormalized') {
    // Full board state was renormalized
    boardState = { columns: {} };
    data.columns.forEach(col => {
      boardState.columns[col.id] = {
        title: col.title,
        position: col.position,
        cards: {},
      };
      col.cards.forEach(card => {
        boardState.columns[col.id].cards[card.id] = card;
      });
    });
    renderBoard();
  }
}

// ==================== Rendering ====================

function renderBoard() {
  const boardEl = document.getElementById('board');
  boardEl.innerHTML = '';

  // Sort columns by position
  const columns = Object.values(boardState.columns).sort((a, b) => a.position - b.position);

  columns.forEach(col => {
    const columnEl = document.createElement('div');
    columnEl.className = 'column';
    columnEl.dataset.columnId = col.id;

    // Header
    const headerEl = document.createElement('div');
    headerEl.className = 'column-header';
    headerEl.textContent = col.title;
    columnEl.appendChild(headerEl);

    // Cards container
    const cardsEl = document.createElement('div');
    cardsEl.className = 'column-cards';
    cardsEl.dataset.columnId = col.id;

    // Sort cards by position
    const cards = Object.values(col.cards).sort((a, b) => a.position - b.position);

    cards.forEach(card => {
      renderCard(card, col.id);
      cardsEl.appendChild(domCache.get(card.id));
    });

    columnEl.appendChild(cardsEl);

    // Add card form
    const formEl = document.createElement('form');
    formEl.className = 'add-card-form';
    formEl.innerHTML = `
      <input type="text" placeholder="Add a card..." />
      <button type="submit">Add</button>
    `;
    formEl.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = formEl.querySelector('input');
      const text = input.value.trim();
      if (text) {
        createCard(col.id, text).then(() => {
          input.value = '';
        });
      }
    });
    columnEl.appendChild(formEl);

    // Drop target handlers
    cardsEl.addEventListener('dragover', handleDragOver);
    cardsEl.addEventListener('drop', handleDrop);

    boardEl.appendChild(columnEl);
  });
}

function renderCard(card, columnId) {
  // Remove existing element if present
  if (domCache.has(card.id)) {
    domCache.get(card.id).remove();
  }

  const cardEl = document.createElement('div');
  cardEl.className = 'card';
  cardEl.draggable = true;
  cardEl.dataset.cardId = card.id;
  cardEl.textContent = card.text;

  cardEl.addEventListener('dragstart', handleDragStart);
  cardEl.addEventListener('dragend', handleDragEnd);

  domCache.set(card.id, cardEl);
}

// ==================== Drag and Drop ====================

let dragState = null; // { cardId, fromColumnId, fromPosition }

function handleDragStart(e) {
  const cardEl = e.target.closest('.card');
  if (!cardEl) return;
  
  const cardId = cardEl.dataset.cardId;
  
  // Find which column this card is in
  let fromColumnId = null;
  for (const colId in boardState.columns) {
    if (boardState.columns[colId].cards[cardId]) {
      fromColumnId = colId;
      break;
    }
  }

  dragState = {
    cardId,
    fromColumnId,
    fromPosition: boardState.columns[fromColumnId]?.cards[cardId]?.position,
  };

  cardEl.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  // Use a transparent drag image to avoid showing the element
  e.dataTransfer.setData('text/plain', cardId);
}

function handleDragEnd(e) {
  const cardEl = e.target.closest('.card');
  if (cardEl) {
    cardEl.classList.remove('dragging');
  }
  document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
  document.querySelectorAll('.column.drag-over').forEach(el => el.classList.remove('drag-over'));
  dragState = null;
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  const cardsEl = e.currentTarget;
  const columnEl = cardsEl.closest('.column');
  
  if (columnEl) {
    columnEl.classList.add('drag-over');
  }

  // Find the card element we're over
  const cards = [...cardsEl.querySelectorAll('.card:not(.dragging)')];
  let targetCard = null;
  
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    if (e.clientY < rect.top + rect.height / 2) {
      targetCard = card;
      break;
    }
  }

  // Clear all drop targets
  document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));

  if (targetCard) {
    targetCard.classList.add('drop-target');
  }
}

function handleDrop(e) {
  e.preventDefault();
  const cardsEl = e.currentTarget;
  const toColumnId = cardsEl.dataset.columnId;

  if (!dragState) return;

  // Find the target card (the one we're dropping before)
  const cards = [...cardsEl.querySelectorAll('.card:not(.dragging)')];
  let targetCard = null;
  
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    if (e.clientY < rect.top + rect.height / 2) {
      targetCard = card;
      break;
    }
  }

  // Optimistic update: move card in the DOM immediately
  const cardEl = domCache.get(dragState.cardId);
  if (targetCard) {
    cardsEl.insertBefore(cardEl, targetCard);
  } else {
    cardsEl.appendChild(cardEl);
  }

  // Determine beforeId and afterId for the server request
  let beforeId = null;
  let afterId = null;
  
  if (targetCard) {
    beforeId = targetCard.dataset.cardId;
  } else {
    // Find the last card in the column (excluding the dragged card)
    const allCards = [...cardsEl.querySelectorAll('.card')].filter(el => el.dataset.cardId !== dragState.cardId);
    if (allCards.length > 0) {
      afterId = allCards[allCards.length - 1].dataset.cardId;
    }
  }

  // Send the move request to the server
  moveCard(dragState.cardId, { columnId: toColumnId, beforeId, afterId })
    .catch(err => {
      console.error('Move failed, re-rendering board:', err);
      renderBoard();
    });

  // Clean up
  document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
  document.querySelectorAll('.column.drag-over').forEach(el => el.classList.remove('drag-over'));
  dragState = null;
}

// ==================== Initialization ====================

async function init() {
  // Fetch initial board state
  const board = await fetchBoard();
  boardState = { columns: {} };
  board.columns.forEach(col => {
    boardState.columns[col.id] = {
      title: col.title,
      position: col.position,
      cards: {},
    };
    col.cards.forEach(card => {
      boardState.columns[col.id].cards[card.id] = card;
    });
  });

  // Render the board
  renderBoard();

  // Connect to SSE for real-time updates
  connectSSE();
}

init();

// Kanban Board Frontend

const API_BASE = '/api';
// For SSE, try to connect to the server directly if proxy fails
const SSE_BASE = window.location.origin; // Will be proxied via /api/stream

// State
let boardState = []; // Array of { id, title, position, cards: [...] }
let dragState = null; // { cardId, sourceColumnId, sourceIndex }

// Track IDs of cards added via optimistic update to avoid SSE duplicates
let optimisticIds = new Set();

// DOM references
const boardEl = document.getElementById('board');

// ---- API Functions ----

async function fetchBoard() {
  const res = await fetch(`${API_BASE}/board`);
  if (!res.ok) throw new Error(`Failed to fetch board: ${res.status}`);
  return res.json();
}

async function createCard(columnId, text) {
  const res = await fetch(`${API_BASE}/cards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ columnId, text }),
  });
  if (!res.ok) throw new Error(`Failed to create card: ${res.status}`);
  return res.json();
}

async function moveCard(cardId, columnId, beforeId, afterId) {
  const res = await fetch(`${API_BASE}/cards/${cardId}/move`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ columnId, beforeId, afterId }),
  });
  if (!res.ok) throw new Error(`Failed to move card: ${res.status}`);
  return res.json();
}

// ---- SSE Connection ----

function connectSSE() {
  const eventSource = new EventSource(SSE_BASE + '/api/stream');

  eventSource.addEventListener('board-sync', (e) => {
    const state = JSON.parse(e.data);
    boardState = state;
    optimisticIds.clear();
    renderBoard();
  });

  eventSource.addEventListener('card-created', (e) => {
    const card = JSON.parse(e.data);

    // Skip if this was our own optimistic update
    if (optimisticIds.has(card.id)) {
      optimisticIds.delete(card.id);
      return;
    }

    // Skip if card already exists
    const exists = boardState.some(col => col.cards.some(c => c.id === card.id));
    if (exists) return;

    const column = boardState.find(c => c.id === card.column_id);
    if (column) {
      let inserted = false;
      for (let i = 0; i < column.cards.length; i++) {
        if (card.position < column.cards[i].position) {
          column.cards.splice(i, 0, card);
          inserted = true;
          break;
        }
      }
      if (!inserted) {
        column.cards.push(card);
      }
      renderBoard();
    }
  });

  eventSource.addEventListener('card-moved', (e) => {
    const card = JSON.parse(e.data);
    let movedCard = null;
    for (const col of boardState) {
      const idx = col.cards.findIndex(c => c.id === card.id);
      if (idx !== -1) {
        movedCard = col.cards.splice(idx, 1)[0];
        break;
      }
    }
    if (movedCard) {
      movedCard.column_id = card.column_id;
      movedCard.position = card.position;
      const targetCol = boardState.find(c => c.id === card.column_id);
      if (targetCol) {
        let inserted = false;
        for (let i = 0; i < targetCol.cards.length; i++) {
          if (card.position < targetCol.cards[i].position) {
            targetCol.cards.splice(i, 0, movedCard);
            inserted = true;
            break;
          }
        }
        if (!inserted) {
          targetCol.cards.push(movedCard);
        }
        renderBoard();
      }
    }
  });

  eventSource.addEventListener('column-renormalized', (e) => {
    const { columnId, cards } = JSON.parse(e.data);
    const column = boardState.find(c => c.id === columnId);
    if (column) {
      column.cards = cards;
      renderBoard();
    }
  });

  eventSource.onerror = (e) => {
    console.error('SSE error:', e);
  };

  return eventSource;
}

// ---- Rendering ----

function renderBoard() {
  boardEl.innerHTML = '';

  const sortedColumns = [...boardState].sort((a, b) => a.position - b.position);

  for (const column of sortedColumns) {
    const columnEl = document.createElement('div');
    columnEl.className = 'column';
    columnEl.dataset.columnId = column.id;

    const headerEl = document.createElement('div');
    headerEl.className = 'column-header';
    headerEl.textContent = column.title;
    columnEl.appendChild(headerEl);

    const cardListEl = document.createElement('div');
    cardListEl.className = 'card-list';
    cardListEl.dataset.columnId = column.id;

    const sortedCards = [...column.cards].sort((a, b) => a.position - b.position);

    for (const card of sortedCards) {
      const cardEl = createCardElement(card);
      cardListEl.appendChild(cardEl);
    }

    columnEl.appendChild(cardListEl);

    const formEl = createAddCardForm(column.id);
    columnEl.appendChild(formEl);

    // Column drop zone
    columnEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      columnEl.classList.add('drag-over-column');
    });

    columnEl.addEventListener('dragleave', (e) => {
      if (!columnEl.contains(e.relatedTarget)) {
        columnEl.classList.remove('drag-over-column');
      }
    });

    columnEl.addEventListener('drop', (e) => {
      e.preventDefault();
      columnEl.classList.remove('drag-over-column');

      if (!dragState) return;

      const { cardId, sourceColumnId, sourceIndex } = dragState;
      const targetColumnId = columnEl.dataset.columnId;

      // Find drop position relative to cards in target column
      const cardElements = cardListEl.querySelectorAll('.card:not(.dragging)');
      let beforeId = null;
      let afterId = null;

      for (const cardEl of cardElements) {
        const rect = cardEl.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          beforeId = cardEl.dataset.cardId;
          break;
        }
        afterId = cardEl.dataset.cardId;
      }

      // Optimistic update
      optimisticMove(cardId, sourceColumnId, sourceIndex, targetColumnId, beforeId, afterId);

      // Send to server
      moveCard(cardId, targetColumnId, beforeId, afterId).catch((err) => {
        console.error('Move failed, will reconcile from SSE:', err);
      });

      dragState = null;
    });

    boardEl.appendChild(columnEl);
  }
}

function createCardElement(card) {
  const cardEl = document.createElement('div');
  cardEl.className = 'card';
  cardEl.draggable = true;
  cardEl.dataset.cardId = card.id;
  cardEl.textContent = card.text;

  cardEl.addEventListener('dragstart', (e) => {
    dragState = {
      cardId: card.id,
      sourceColumnId: card.column_id,
      sourceIndex: card.position,
    };
    cardEl.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  cardEl.addEventListener('dragend', () => {
    cardEl.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  });

  cardEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    cardEl.classList.add('drag-over');
  });

  cardEl.addEventListener('dragleave', () => {
    cardEl.classList.remove('drag-over');
  });

  return cardEl;
}

function createAddCardForm(columnId) {
  const form = document.createElement('div');
  form.className = 'add-card-form';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Enter a card title...';
  input.dataset.columnId = columnId;

  const button = document.createElement('button');
  button.textContent = 'Add Card';

  const handleSubmit = (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    createCard(columnId, text).then((card) => {
      optimisticIds.add(card.id);
      const column = boardState.find(c => c.id === columnId);
      if (column) {
        column.cards.push(card);
        renderBoard();
      }
    }).catch((err) => {
      console.error('Create card failed:', err);
    });

    input.value = '';
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      handleSubmit(e);
    }
  });

  button.addEventListener('click', handleSubmit);

  form.appendChild(input);
  form.appendChild(button);

  return form;
}

// Optimistic move: update local state immediately, then reconcile from SSE
function optimisticMove(cardId, sourceColumnId, sourceIndex, targetColumnId, beforeId, afterId) {
  let movedCard = null;
  let sourceCol = null;

  for (const col of boardState) {
    const idx = col.cards.findIndex(c => c.id === cardId);
    if (idx !== -1) {
      movedCard = col.cards[idx];
      sourceCol = col;
      col.cards.splice(idx, 1);
      break;
    }
  }

  if (!movedCard) return;

  const targetCol = boardState.find(c => c.id === targetColumnId);
  if (!targetCol) return;

  // Calculate optimistic position
  let optimisticPosition;
  if (beforeId) {
    const beforeCard = targetCol.cards.find(c => c.id === beforeId);
    optimisticPosition = beforeCard ? beforeCard.position - 1 : 1;
  } else if (afterId) {
    const afterCard = targetCol.cards.find(c => c.id === afterId);
    optimisticPosition = afterCard ? afterCard.position + 1 : 1;
  } else {
    const maxPos = targetCol.cards.reduce((max, c) => Math.max(max, c.position), 0);
    optimisticPosition = maxPos + 1;
  }

  if (optimisticPosition <= 0) optimisticPosition = 1;

  movedCard.position = optimisticPosition;
  movedCard.column_id = targetColumnId;

  let inserted = false;
  for (let i = 0; i < targetCol.cards.length; i++) {
    if (optimisticPosition < targetCol.cards[i].position) {
      targetCol.cards.splice(i, 0, movedCard);
      inserted = true;
      break;
    }
  }
  if (!inserted) {
    targetCol.cards.push(movedCard);
  }

  renderBoard();
}

// ---- Init ----

async function init() {
  boardState = await fetchBoard();
  renderBoard();
  connectSSE();
}

init();

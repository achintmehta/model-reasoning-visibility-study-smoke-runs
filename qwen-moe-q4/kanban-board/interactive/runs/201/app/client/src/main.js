// Kanban Board Frontend

const API_BASE = '/api';

// State
let boardState = []; // Array of { id, title, position, cards: [...] }
let dragState = null; // { cardId, sourceColumnId, sourceIndex }

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
  const eventSource = new EventSource(`${API_BASE}/stream`);

  eventSource.addEventListener('board-sync', (e) => {
    const state = JSON.parse(e.data);
    boardState = state;
    renderBoard();
  });

  eventSource.addEventListener('card-created', async (e) => {
    await reSyncBoard();
  });

  eventSource.addEventListener('card-moved', async (e) => {
    await reSyncBoard();
  });

  eventSource.addEventListener('column-renormalized', async (e) => {
    await reSyncBoard();
  });

  eventSource.onerror = (e) => {
    console.error('SSE error, reconnecting...', e);
  };

  return eventSource;
}

async function reSyncBoard() {
  try {
    boardState = await fetchBoard();
    renderBoard();
  } catch (err) {
    console.error('Failed to re-sync board:', err);
  }
}

// ---- Rendering ----

function renderBoard() {
  boardEl.innerHTML = '';

  // Sort columns by position
  const sortedColumns = [...boardState].sort((a, b) => a.position - b.position);

  for (const column of sortedColumns) {
    const columnEl = document.createElement('div');
    columnEl.className = 'column';
    columnEl.dataset.columnId = column.id;

    // Header
    const headerEl = document.createElement('div');
    headerEl.className = 'column-header';
    headerEl.textContent = column.title;
    columnEl.appendChild(headerEl);

    // Card list
    const cardListEl = document.createElement('div');
    cardListEl.className = 'card-list';
    cardListEl.dataset.columnId = column.id;

    // Sort cards by position
    const sortedCards = [...column.cards].sort((a, b) => a.position - b.position);

    for (const card of sortedCards) {
      const cardEl = createCardElement(card);
      cardListEl.appendChild(cardEl);
    }

    columnEl.appendChild(cardListEl);

    // Add card form
    const formEl = createAddCardForm(column.id);
    columnEl.appendChild(formEl);

    // Drop zone events on column (only when dropping on the card-list area or empty column area)
    columnEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
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

      // Determine the drop target - if we dropped on a card, find the before/after position
      // If we dropped on the card-list area (not on a card), determine position relative to cards
      const cardElements = Array.from(cardListEl.querySelectorAll('.card:not(.dragging)'));
      let beforeId = null;
      let afterId = null;

      // Find which card (if any) we're dropping over
      let droppedOnCard = false;
      for (const cardEl of cardElements) {
        const rect = cardEl.getBoundingClientRect();
        if (
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom
        ) {
          droppedOnCard = true;
          // Determine if we're dropping above or below the midpoint
          const midY = rect.top + rect.height / 2;
          if (e.clientY < midY) {
            beforeId = cardEl.dataset.cardId;
          } else {
            afterId = cardEl.dataset.cardId;
          }
          break;
        }
      }

      // If dropped on the card-list area but not on a specific card
      if (!droppedOnCard) {
        const cardListRect = cardListEl.getBoundingClientRect();
        if (
          e.clientX >= cardListRect.left &&
          e.clientX <= cardListRect.right &&
          e.clientY >= cardListRect.top &&
          e.clientY <= cardListRect.bottom
        ) {
          // Drop at the end of the column
          // Find the last card
          if (cardElements.length > 0) {
            afterId = cardElements[cardElements.length - 1].dataset.cardId;
          }
        }
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
    e.dataTransfer.setData('text/plain', card.id);
  });

  cardEl.addEventListener('dragend', () => {
    cardEl.classList.remove('dragging');
    // Clean up all drag-over classes
    document.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
  });

  cardEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    // Add visual indicator
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
      // Optimistic update
      const column = boardState.find((c) => c.id === columnId);
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
  // Find the card in current state
  let movedCard = null;
  let sourceCol = null;

  for (const col of boardState) {
    const idx = col.cards.findIndex((c) => c.id === cardId);
    if (idx !== -1) {
      movedCard = col.cards[idx];
      sourceCol = col;
      // Remove from source
      col.cards.splice(idx, 1);
      break;
    }
  }

  if (!movedCard) return;

  // Insert at correct position in target column
  const targetCol = boardState.find((c) => c.id === targetColumnId);
  if (!targetCol) return;

  // Calculate optimistic position
  let optimisticPosition;
  if (beforeId) {
    const beforeCard = targetCol.cards.find((c) => c.id === beforeId);
    optimisticPosition = beforeCard ? beforeCard.position - 1 : 1;
  } else if (afterId) {
    const afterCard = targetCol.cards.find((c) => c.id === afterId);
    optimisticPosition = afterCard ? afterCard.position + 1 : 1;
  } else {
    const maxPos = targetCol.cards.reduce((max, c) => Math.max(max, c.position), 0);
    optimisticPosition = maxPos + 1;
  }

  if (optimisticPosition <= 0) optimisticPosition = 1;

  movedCard.position = optimisticPosition;
  movedCard.column_id = targetColumnId;

  // Insert at correct position
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

// ---- Init with retry ----

async function init() {
  let retries = 0;
  const maxRetries = 10;

  while (retries < maxRetries) {
    try {
      boardState = await fetchBoard();
      renderBoard();
      connectSSE();
      return;
    } catch (err) {
      retries++;
      if (retries >= maxRetries) {
        console.error('Failed to connect to server after retries:', err);
        return;
      }
      console.log(`Retrying connection to server... (${retries}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, 500 * retries));
    }
  }
}

init();

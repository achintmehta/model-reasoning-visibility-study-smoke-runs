// Kanban Board Frontend - Vanilla JS with SSE real-time sync

const API_BASE = '/api';

// State management
let boardState = { columns: [] };
let dragState = {
  cardId: null,
  sourceColumnId: null,
  sourceIndex: null,
};

// DOM references
const boardEl = document.getElementById('board');

// ---- API Functions ----

async function fetchBoard() {
  const res = await fetch(`${API_BASE}/board`);
  return res.json();
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

// ---- Rendering ----

function renderBoard() {
  boardEl.innerHTML = '';

  // Sort columns by position
  const sortedColumns = [...boardState.columns].sort((a, b) => a.position - b.position);

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

    // Render cards sorted by position
    const sortedCards = [...(column.cards || [])].sort((a, b) => a.position - b.position);

    for (let i = 0; i < sortedCards.length; i++) {
      const card = sortedCards[i];
      const cardEl = createCardElement(card, i, column.id);
      cardListEl.appendChild(cardEl);
    }

    columnEl.appendChild(cardListEl);

    // Add card form
    const formEl = document.createElement('form');
    formEl.className = 'add-card-form';
    formEl.innerHTML = `
      <input type="text" placeholder="Enter a card title..." />
      <button type="submit">Add</button>
    `;
    formEl.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = formEl.querySelector('input');
      const text = input.value.trim();
      if (text) {
        createCard(column.id, text).then((card) => {
          // Optimistically add the card
          if (!column.cards) column.cards = [];
          column.cards.push(card);
          renderBoard();
          input.value = '';
        });
      }
    });
    columnEl.appendChild(formEl);

    // Drop zone for the column
    cardListEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      const draggingCard = document.querySelector('.card.dragging');
      if (!draggingCard) return;

      // Remove existing drop indicators
      document.querySelectorAll('.card-drop-indicator').forEach((el) => el.remove());

      // Find the card we're hovering over
      const cards = [...cardListEl.querySelectorAll('.card:not(.dragging)')];
      let insertIndex = cards.length;

      for (let i = 0; i < cards.length; i++) {
        const rect = cards[i].getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          insertIndex = i;
          break;
        }
      }

      // Insert drop indicator
      const indicator = document.createElement('div');
      indicator.className = 'card-drop-indicator';
      if (insertIndex < cards.length) {
        cardListEl.insertBefore(indicator, cards[insertIndex]);
      } else {
        cardListEl.appendChild(indicator);
      }
    });

    cardListEl.addEventListener('dragleave', (e) => {
      // Only remove if actually leaving the card list
      if (!cardListEl.contains(e.relatedTarget)) {
        document.querySelectorAll('.card-drop-indicator').forEach((el) => el.remove());
      }
    });

    cardListEl.addEventListener('drop', (e) => {
      e.preventDefault();
      document.querySelectorAll('.card-drop-indicator').forEach((el) => el.remove());

      const { cardId, sourceColumnId, sourceIndex } = dragState;
      if (!cardId) return;

      // Find the target column
      const targetColumn = boardState.columns.find((c) => c.id === column.id);
      if (!targetColumn) return;

      // Find the insert position
      const cards = [...cardListEl.querySelectorAll('.card:not(.dragging)')];
      let insertIndex = cards.length;

      for (let i = 0; i < cards.length; i++) {
        const rect = cards[i].getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          insertIndex = i;
          break;
        }
      }

      // Determine beforeId and afterId
      let beforeId = null;
      let afterId = null;
      if (insertIndex < cards.length) {
        beforeId = cards[insertIndex].dataset.cardId;
      }
      if (insertIndex > 0) {
        afterId = cards[insertIndex - 1].dataset.cardId;
      }

      // Remove the card from source position optimistically
      const sourceCol = boardState.columns.find((c) => c.id === sourceColumnId);
      if (sourceCol) {
        sourceCol.cards = sourceCol.cards.filter((c) => c.id !== cardId);
      }

      // Find the card in target column (after removal from source)
      let targetCard = targetColumn.cards.find((c) => c.id === cardId);
      if (!targetCard) {
        // Card is coming from another column, find it globally
        for (const col of boardState.columns) {
          targetCard = col.cards.find((c) => c.id === cardId);
          if (targetCard) break;
        }
      }

      if (targetCard) {
        // Remove from old position in target column
        targetColumn.cards = targetColumn.cards.filter((c) => c.id !== cardId);

        // Calculate optimistic position
        const sortedCards = [...targetColumn.cards].sort((a, b) => a.position - b.position);
        let targetPosition;

        if (sortedCards.length === 0) {
          targetPosition = 50;
        } else if (insertIndex === 0) {
          targetPosition = sortedCards[0].position / 2;
        } else if (insertIndex >= sortedCards.length) {
          targetPosition = sortedCards[sortedCards.length - 1].position + 50;
        } else {
          targetPosition = (sortedCards[insertIndex - 1].position + sortedCards[insertIndex].position) / 2;
        }

        // Update the card's column and position optimistically
        targetCard.columnId = targetColumn.id;
        targetCard.position = targetPosition;

        // Insert at the right position
        targetColumn.cards.push(targetCard);
        targetColumn.cards.sort((a, b) => a.position - b.position);

        // Render optimistically
        renderBoard();

        // Send the move to the server
        moveCard(cardId, {
          columnId: targetColumn.id,
          beforeId,
          afterId,
        }).catch((err) => {
          console.error('Move failed:', err);
          // Re-fetch from server on failure
          reloadBoard();
        });
      }

      dragState = { cardId: null, sourceColumnId: null, sourceIndex: null };
    });

    boardEl.appendChild(columnEl);
  }
}

function createCardElement(card, index, columnId) {
  const cardEl = document.createElement('div');
  cardEl.className = 'card';
  cardEl.draggable = true;
  cardEl.dataset.cardId = card.id;

  const textEl = document.createElement('span');
  textEl.textContent = card.text;
  cardEl.appendChild(textEl);

  cardEl.addEventListener('dragstart', (e) => {
    dragState = {
      cardId: card.id,
      sourceColumnId: columnId,
      sourceIndex: index,
    };
    cardEl.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  cardEl.addEventListener('dragend', () => {
    cardEl.classList.remove('dragging');
    document.querySelectorAll('.card-drop-indicator').forEach((el) => el.remove());
    dragState = { cardId: null, sourceColumnId: null, sourceIndex: null };
  });

  return cardEl;
}

// ---- SSE Connection ----

function connectSSE() {
  const eventSource = new EventSource(`${API_BASE}/stream`);

  eventSource.addEventListener('card-created', (event) => {
    const data = JSON.parse(event.data);
    const { card, columnId } = data;

    const column = boardState.columns.find((c) => c.id === columnId);
    if (column) {
      if (!column.cards) column.cards = [];
      column.cards.push(card);
      renderBoard();
    }
  });

  eventSource.addEventListener('card-moved', (event) => {
    const data = JSON.parse(event.data);
    const { card, columnId } = data;

    // Remove card from all columns
    for (const col of boardState.columns) {
      col.cards = col.cards.filter((c) => c.id !== card.id);
    }

    // Add to target column
    const column = boardState.columns.find((c) => c.id === columnId);
    if (column) {
      if (!column.cards) column.cards = [];
      column.cards.push(card);
      renderBoard();
    }
  });

  eventSource.addEventListener('columns-renormalized', (event) => {
    const data = JSON.parse(event.data);
    boardState.columns = data.columns;
    renderBoard();
  });

  eventSource.onerror = (err) => {
    console.error('SSE connection error:', err);
  };

  return eventSource;
}

// ---- Initialization ----

async function reloadBoard() {
  try {
    boardState = await fetchBoard();
    renderBoard();
  } catch (err) {
    console.error('Failed to load board:', err);
  }
}

// Start the app
async function init() {
  await reloadBoard();
  connectSSE();
}

init();

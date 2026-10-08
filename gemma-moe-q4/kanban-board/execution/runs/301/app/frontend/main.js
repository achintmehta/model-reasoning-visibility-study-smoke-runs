const API_BASE = 'http://localhost:3001/api';

let boardState = [];

const boardElement = document.getElementById('board');

async function fetchBoard() {
  try {
    const response = await fetch(`${API_BASE}/board`);
    boardState = await response.json();
    renderBoard();
  } catch (err) {
    console.error('Failed to fetch board:', err);
  }
}

function renderBoard() {
  boardElement.innerHTML = '';
  boardState.forEach(column => {
    const columnEl = document.createElement('div');
    columnEl.className = 'column';
    columnEl.dataset.id = column.id;
    columnEl.innerHTML = `
      <h2>${column.title}</h2>
      <div class="card-list" data-column-id="${column.id}"></div>
      <div class="card-form">
        <input type="text" placeholder="New card..." class="card-input">
        <button class="add-card-btn">Add</button>
      </div>
    `;

    const cardListEl = columnEl.querySelector('.card-list');
    column.cards.forEach(card => {
      const cardEl = createCardElement(card);
      cardListEl.appendChild(cardEl);
    });

    // Add card event
    columnEl.querySelector('.add-card-btn').addEventListener('click', () => {
      const input = columnEl.querySelector('.card-input');
      const text = input.value.trim();
      if (text) {
        createCard(column.id, text);
        input.value = '';
      }
    });

    // Drag and drop events on the card list
    cardListEl.addEventListener('dragover', handleDragOver);
    cardListEl.addEventListener('drop', handleDrop);

    boardElement.appendChild(columnEl);
  });
}

function createCardElement(card) {
  const cardEl = document.createElement('div');
  cardEl.className = 'card';
  cardEl.draggable = true;
  cardEl.id = `card-${card.id}`;
  cardEl.textContent = card.text;
  cardEl.dataset.id = card.id;

  cardEl.addEventListener('dragstart', handleDragStart);
  cardEl.addEventListener('dragend', handleDragEnd);

  return cardEl;
}

let draggedCardId = null;

function handleDragStart(e) {
  draggedCardId = e.target.dataset.id;
  e.target.classList.add('dragging');
}

function handleDragEnd(e) {
  e.target.classList.remove('dragging');
  draggedCardId = null;
}

function handleDragOver(e) {
  e.preventDefault();
  const cardList = e.currentTarget;
  const afterElement = getDragAfterElement(cardList, e.clientY);
  const draggingCard = document.getElementById(`card-${draggedCardId}`);
  if (afterElement == null) {
    cardList.appendChild(draggingCard);
  } else {
    cardList.insertBefore(draggingCard, afterElement);
  }
}

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.card:not(.dragging)')];

  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

async function createCard(columnId, text) {
  await fetch(`${API_BASE}/cards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ columnId, text })
  });
}

async function handleDrop(e) {
  e.preventDefault();
  if (!draggedCardId) return;

  const cardList = e.currentTarget;
  const targetColumnId = cardList.dataset.columnId;
  const cardEl = document.getElementById(`card-${draggedCardId}`);
  
  const newCardsInCol = [...cardList.querySelectorAll('.card')];
  const newIndex = newCardsInCol.indexOf(cardEl);

  let beforeId = null;
  let afterId = null;

  if (newIndex > 0) {
    beforeId = newCardsInCol[newIndex - 1].dataset.id;
  }
  if (newIndex < newCardsInCol.length - 1) {
    afterId = newCardsInCol[newIndex + 1].dataset.id;
  }

  // Send the move request
  try {
    await fetch(`${API_BASE}/cards/${draggedCardId}/move`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columnId: targetColumnId, beforeId, afterId })
    });
  } catch (err) {
    console.error('Failed to move card:', err);
    // If it fails, we should ideally re-fetch the board to sync back to reality
    fetchBoard();
  }
}

function setupSSE() {
  const sseUrl = 'http://localhost:3001/api/stream';
  const es = new EventSource(sseUrl);

  es.onmessage = (event) => {
    const { type, payload } = JSON.parse(event.data);
    console.log('SSE received:', type, payload);
    
    if (type === 'CARD_CREATED') {
      handleCardCreated(payload);
    } else if (type === 'CARD_MOVED') {
      handleCardMoved(payload);
    } else if (type === 'COLUMN_UPDATED') {
      handleColumnUpdated(payload);
    }
  };

  es.onerror = (err) => {
    console.error('SSE error:', err);
  };
}

function handleCardCreated(newCard) {
  const column = boardState.find(c => c.id === newCard.columnId);
  if (column) {
    column.cards.push(newCard);
    renderBoard();
  }
}

function handleCardMoved(movedCard) {
  // Remove from old position in state
  boardState.forEach(col => {
    col.cards = col.cards.filter(card => card.id !== movedCard.id);
  });

  // Add to new position in state
  const column = boardState.find(c => c.id === movedCard.columnId);
  if (column) {
    column.cards.push(movedCard);
    column.cards.sort((a, b) => a.position - b.position);
  }

  renderBoard();
}

function handleColumnUpdated(payload) {
  const { columnId, cards } = payload;
  const column = boardState.find(c => c.id === columnId);
  if (column) {
    column.cards = cards;
    renderBoard();
  }
}

// Initialize
fetchBoard();
setupSSE();

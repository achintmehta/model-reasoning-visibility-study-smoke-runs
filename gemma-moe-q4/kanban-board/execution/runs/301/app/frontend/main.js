import './style.css';

const API_BASE = 'http://localhost:3001/api';
const SSE_URL = 'http://localhost:3001/api/stream';

let board = [];

const boardEl = document.getElementById('board');

async function fetchBoard() {
  const res = await fetch(`${API_BASE}/board`);
  board = await res.json();
  renderBoard();
}

function renderBoard() {
  boardEl.innerHTML = '';
  board.forEach(column => {
    const columnEl = document.createElement('div');
    columnEl.className = 'column';
    columnEl.dataset.id = column.id;
    columnEl.innerHTML = `
      <h2>${column.title}</h2>
      <div class="card-list" data-column-id="${column.id}"></div>
      <div class="card-form">
        <input type="text" placeholder="Add a card..." />
        <button>Add</button>
      </div>
    `;

    const cardListEl = columnEl.querySelector('.card-list');
    column.cards.forEach(card => {
      const cardEl = createCardElement(card);
      cardListEl.appendChild(cardEl);
    });

    const form = columnEl.querySelector('.card-form');
    const input = form.querySelector('input');
    const button = form.querySelector('button');

    button.onclick = async () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      await createCard(column.id, text);
    };

    input.onkeypress = (e) => {
      if (e.key === 'Enter') button.click();
    };

    // Drag and drop listeners for the column
    cardListEl.addEventListener('dragover', handleDragOver);
    cardListEl.addEventListener('drop', (e) => handleDrop(e, column.id, null, null));

    boardEl.appendChild(columnEl);
  });
}

function createCardElement(card) {
  const cardEl = document.createElement('div');
  cardEl.className = 'card';
  cardEl.textContent = card.text;
  cardEl.dataset.id = card.id;
  cardEl.draggable = true;

  cardEl.addEventListener('dragstart', handleDragStart);
  cardEl.addEventListener('dragend', handleDragEnd);
  
  // To handle dropping on a card to place before/after it
  cardEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = cardEl.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    cardEl.classList.toggle('drop-before', e.clientY < midpoint);
    cardEl.classList.toggle('drop-after', e.clientY >= midpoint);
  });

  cardEl.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = cardEl.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    
    if (e.clientY < midpoint) {
      handleDrop(e, card.column_id, card.id, null); // before card.id
    } else {
      handleDrop(e, card.column_id, null, card.id); // after card.id
    }
  });

  return cardEl;
}

// Globals for drag and drop
let draggedCardId = null;

function handleDragStart(e) {
  draggedCardId = e.target.dataset.id;
  e.target.classList.add('dragging');
}

function handleDragEnd(e) {
  e.target.classList.remove('dragging');
  document.querySelectorAll('.card').forEach(el => {
    el.classList.remove('drop-before', 'drop-after');
  });
}

function handleDragOver(e) {
  e.preventDefault();
}

async function handleDrop(e, targetColumnId, beforeId, afterId) {
  e.preventDefault();
  if (!draggedCardId) return;

  // Find the dragged card in the current state
  let draggedCard;
  for (const col of board) {
    const found = col.cards.find(c => c.id === draggedCardId);
    if (found) {
      draggedCard = found;
      break;
    }
  }

  if (!draggedCard) return;

  const originalColumnId = draggedCard.column_id;

  // Optimistic Update
  // 1. Remove from original column
  const originalCol = board.find(c => c.id === originalColumnId);
  if (originalCol) {
    originalCol.cards = originalCol.cards.filter(c => c.id !== draggedCardId);
  }

  // 2. Add to target column
  const targetCol = board.find(c => c.id === targetColumnId);
  if (targetCol) {
    // For optimistic UI, we just append it for now, or insert it.
    // To keep it simple, let's just append it.
    targetCol.cards.push({ ...draggedCard, column_id: targetColumnId });
  }

  renderBoard();

  // 3. Send request to server
  try {
    const res = await fetch(`${API_BASE}/cards/${draggedCardId}/move`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        columnId: targetColumnId,
        beforeId,
        afterId
      })
    });

    if (!res.ok) {
      throw new Error('Failed to move card');
    }
    
    // We don't need to do anything else here because SSE will sync the canonical state.
    // But if we wanted to be more robust, we could reconcile here.
  } catch (err) {
    console.error(err);
    // If it fails, re-fetch the board to revert optimistic state
    await fetchBoard();
  } finally {
    draggedCardId = null;
  }
}

async function createCard(columnId, text) {
  try {
    const res = await fetch(`${API_BASE}/cards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columnId, text })
    });
    if (!res.ok) throw new Error('Failed to create card');
  } catch (err) {
    console.error(err);
    await fetchBoard();
  }
}

// SSE Connection
const eventSource = new EventSource(SSE_URL);

eventSource.onmessage = (event) => {
  const { event: eventType, data } = JSON.parse(event.data);
  console.log('SSE event:', eventType, data);

  if (eventType === 'card-created') {
    // Find column and add card
    const col = board.find(c => c.id === data.column_id);
    if (col) {
      col.cards.push(data);
      col.cards.sort((a, b) => a.position - b.position);
    }
  } else if (eventType === 'card-moved') {
    // Remove from old column (if changed) and add to new column
    // The server sends the canonical card, so we just need to update our state.
    
    // 1. Remove everywhere else
    board.forEach(col => {
      col.cards = col.cards.filter(c => c.id !== data.id);
    });

    // 2. Add to new column
    const col = board.find(c => c.id === data.column_id);
    if (col) {
      col.cards.push(data);
      col.cards.sort((a, b) => a.position - b.position);
    }
  }
  renderBoard();
};

eventSource.onerror = (err) => {
  console.error('SSE error:', err);
};

// Start the app
fetchBoard();

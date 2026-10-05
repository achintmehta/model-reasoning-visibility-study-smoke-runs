const API_BASE = 'http://localhost:3001/api';
const SSE_URL = 'http://localhost:3001/api/stream';

let boardState = []; // Array of columns, each with cards

const app = document.getElementById('app');
const boardEl = document.getElementById('board');

async function fetchBoard() {
  try {
    const res = await fetch(`${API_BASE}/board`);
    boardState = await res.json();
    renderBoard();
  } catch (err) {
    console.error('Failed to fetch board:', err);
  }
}

function renderBoard() {
  boardEl.innerHTML = '';
  boardState.forEach(column => {
    const colEl = document.createElement('div');
    colEl.className = 'column';
    colEl.dataset.id = column.id;
    colEl.innerHTML = `
      <h2>${column.title}</h2>
      <div class="card-list" data-column-id="${column.id}"></div>
      <div class="add-card-form">
        <input type="text" placeholder="New card..." class="new-card-input">
        <button class="add-card-btn">Add</button>
      </div>
    `;

    const cardListEl = colEl.querySelector('.card-list');
    column.cards.forEach(card => {
      const cardEl = createCardElement(card);
      cardListEl.appendChild(cardEl);
    });

    const input = colEl.querySelector('.new-card-input');
    const btn = colEl.querySelector('.add-card-btn');

    btn.addEventListener('click', () => createCard(column.id, input.value));
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') createCard(column.id, input.value);
    });

    // Drag and drop listeners for the column/card-list
    cardListEl.addEventListener('dragover', handleDragOver);
    cardListEl.addEventListener('drop', handleDrop);

    boardEl.appendChild(colEl);
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

// --- State Management ---

async function createCard(columnId, text) {
  if (!text.trim()) return;

  const res = await fetch(`${API_BASE}/cards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ columnId, text })
  });

  if (!res.ok) {
    alert('Failed to create card');
  }
}

let draggedCardId = null;

function handleDragStart(e) {
  draggedCardId = e.target.dataset.id;
  e.target.classList.add('dragging');
  e.dataTransfer.setData('text/plain', draggedCardId);
}

function handleDragEnd(e) {
  e.target.classList.remove('dragging');
  draggedCardId = null;
}

function handleDragOver(e) {
  e.preventDefault();
  const cardList = e.currentTarget;
  const afterElement = getDragAfterElement(cardList, e.clientY);
  const draggingEl = document.querySelector('.dragging');
  if (afterElement == null) {
    cardList.appendChild(draggingEl);
  } else {
    cardList.insertBefore(draggingEl, afterElement);
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

async function handleDrop(e) {
  e.preventDefault();
  const cardListEl = e.currentTarget;
  const targetColumnId = cardListEl.dataset.columnId;
  
  const cardEl = document.getElementById(`card-${draggedCardId}`);
  if (!cardEl) return;

  const allCardsInColumn = [...cardListEl.querySelectorAll('.card')];
  const myIndex = allCardsInColumn.indexOf(cardEl);
  
  const afterId = myIndex > 0 ? allCardsInColumn[myIndex - 1].dataset.id : null;
  const beforeId = myIndex < allCardsInColumn.length - 1 ? allCardsInColumn[myIndex + 1].dataset.id : null;

  const movePayload = {
    columnId: targetColumnId,
    beforeId,
    afterId
  };

  try {
    const res = await fetch(`${API_BASE}/cards/${draggedCardId}/move`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(movePayload)
    });

    if (!res.ok) {
      throw new Error('Move failed');
    }
  } catch (err) {
    console.error(err);
    fetchBoard();
  }
}

// --- SSE ---

function setupSSE() {
  const eventSource = new EventSource(SSE_URL);

  eventSource.onmessage = (event) => {
    const { type, data } = JSON.parse(event.data);
    // Re-fetch board to ensure full synchronization and correct ordering
    fetchBoard();
  };

  eventSource.onerror = (err) => {
    console.error('SSE error:', err);
  };
}

// --- Initialization ---

async function init() {
  await fetchBoard();
  setupSSE();
}

init();

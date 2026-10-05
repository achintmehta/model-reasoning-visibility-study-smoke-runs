import './style.css';

const API_BASE = 'http://localhost:3000/api';
const SSE_URL = 'http://localhost:3000/api/stream';

let state = {
  columns: []
};

const boardEl = document.getElementById('board');

async function fetchBoard() {
  const res = await fetch(`${API_BASE}/board`);
  state.columns = await res.json();
  render();
}

async function createCard(columnId, text) {
  await fetch(`${API_BASE}/cards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ columnId, text })
  });
}

async function moveCard(cardId, columnId, beforeId, afterId) {
  await fetch(`${API_BASE}/cards/${cardId}/move`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ columnId, beforeId, afterId })
  });
}

function render() {
  boardEl.innerHTML = '';
  state.columns.forEach(column => {
    const columnEl = document.createElement('div');
    columnEl.className = 'column';
    columnEl.dataset.id = column.id;
    
    columnEl.innerHTML = `
      <div class="column-header">
        <span>${column.title}</span>
      </div>
      <div class="cards-container" data-column-id="${column.id}"></div>
      <div class="card-input-container">
        <input type="text" class="card-input" placeholder="Add a card...">
        <button class="add-btn">Add</button>
      </div>
    `;

    const cardsContainer = columnEl.querySelector('.cards-container');
    column.cards.forEach(card => {
      const cardEl = document.createElement('div');
      cardEl.className = 'card';
      cardEl.draggable = true;
      cardEl.dataset.id = card.id;
      cardEl.textContent = card.text;
      
      cardEl.addEventListener('dragstart', handleDragStart);
      cardEl.addEventListener('dragend', handleDragEnd);
      
      cardsContainer.appendChild(cardEl);
    });

    cardsContainer.addEventListener('dragover', handleDragOver);
    cardsContainer.addEventListener('drop', handleDrop);

    const input = columnEl.querySelector('.card-input');
    const btn = columnEl.querySelector('.add-btn');
    
    const handleAdd = () => {
      const text = input.value.trim();
      if (text) {
        createCard(column.id, text);
        input.value = '';
      }
    };

    btn.addEventListener('click', handleAdd);
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleAdd();
    });

    boardEl.appendChild(columnEl);
  });
}

let draggedCardId = null;
let sourceColumnId = null;

function handleDragStart(e) {
  draggedCardId = e.target.dataset.id;
  sourceColumnId = e.target.closest('.cards-container').dataset.columnId;
  e.target.classList.add('dragging');
}

function handleDragEnd(e) {
  e.target.classList.remove('dragging');
}

function handleDragOver(e) {
  e.preventDefault();
}

function handleDrop(e) {
  e.preventDefault();
  const targetColumnId = e.currentTarget.dataset.columnId;
  const targetCardEl = e.target.closest('.card');
  
  let beforeId = null;
  let afterId = null;

  if (targetCardEl) {
    const targetCardId = targetCardEl.dataset.id;
    if (targetCardId === draggedCardId) return;

    // Determine if we are before or after the target card
    // In a real drag and drop, we'd need more sophisticated logic for dropping between cards
    // For this simple implementation, let's say we drop before or after.
    // To keep it simple, let's just use the targetCardId as 'beforeId' or 'afterId'.
    // Actually, let's check if we are dropping above or below the target card.
    const rect = targetCardEl.getBoundingClientRect();
    const offset = e.clientY - rect.top;
    
    if (offset < rect.height / 2) {
      beforeId = targetCardId;
    } else {
      afterId = targetCardId;
    }
  }

  // Optimistic update: move card in state
  optimisticMove(draggedCardId, sourceColumnId, targetColumnId, beforeId, afterId);
  
  // Send mutation
  moveCard(draggedCardId, parseInt(targetColumnId), beforeId ? parseInt(beforeId) : null, afterId ? parseInt(afterId) : null);
}

function optimisticMove(cardId, sourceColId, targetColId, beforeId, afterId) {
  const cardIdInt = parseInt(cardId);
  const sourceCol = state.columns.find(c => c.id == sourceColId);
  const targetCol = state.columns.find(c => c.id == targetColId);
  
  const cardIdx = sourceCol.cards.findIndex(c => c.id === cardIdInt);
  const [card] = sourceCol.cards.splice(cardIdx, 1);
  
  if (beforeId) {
    const beforeIdx = targetCol.cards.findIndex(c => c.id == beforeId);
    targetCol.cards.splice(beforeIdx, 0, card);
  } else if (afterId) {
    const afterIdx = targetCol.cards.findIndex(c => c.id == afterId);
    targetCol.cards.splice(afterIdx + 1, 0, card);
  } else {
    targetCol.cards.push(card);
  }
  
  render();
}

function initSSE() {
  const eventSource = new EventSource(SSE_URL);

  eventSource.addEventListener('card-created', (e) => {
    const card = JSON.parse(e.data);
    const column = state.columns.find(c => c.id === card.column_id);
    if (column) {
      column.cards.push(card);
      // Re-sort cards by position
      column.cards.sort((a, b) => a.position - b.position);
      render();
    }
  });

  eventSource.addEventListener('card-moved', (e) => {
    const card = JSON.parse(e.data);
    
    // Remove from all columns
    state.columns.forEach(col => {
      col.cards = col.cards.filter(c => c.id !== card.id);
    });

    // Add to the new column
    const column = state.columns.find(c => c.id === card.column_id);
    if (column) {
      column.cards.push(card);
      column.cards.sort((a, b) => a.position - b.position);
    }
    
    render();
  });

  eventSource.onerror = () => {
    console.error('SSE connection failed. Retrying...');
  };
}

fetchBoard();
initSSE();

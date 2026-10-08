const API_BASE = 'http://localhost:4000';
const boardEl = document.getElementById('board');

async function fetchBoard() {
  const res = await fetch(`${API_BASE}/api/board`);
  const board = await res.json();
  renderBoard(board);
}

function renderBoard(board) {
  boardEl.innerHTML = '';
  board.forEach(col => {
    const colEl = document.createElement('div');
    colEl.className = 'column';
    colEl.dataset.id = col.id;

    const header = document.createElement('div');
    header.className = 'column-header';
    header.textContent = col.title;
    colEl.appendChild(header);

    const cardsEl = document.createElement('div');
    cardsEl.className = 'cards';
    cardsEl.dataset.columnId = col.id;
    col.cards.forEach(card => {
      const cardEl = createCardElement(card);
      cardsEl.appendChild(cardEl);
    });
    colEl.appendChild(cardsEl);

    const addBox = document.createElement('div');
    addBox.className = 'add-card';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'New card';
    addBox.appendChild(input);
    const btn = document.createElement('button');
    btn.textContent = 'Add';
    btn.onclick = () => addCard(col.id, input.value, input);
    addBox.appendChild(btn);
    colEl.appendChild(addBox);

    boardEl.appendChild(colEl);
  });
}

function createCardElement(card) {
  const el = document.createElement('div');
  el.className = 'card';
  el.textContent = card.text;
  el.draggable = true;
  el.dataset.id = card.id;

  el.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', card.id);
    e.dataTransfer.effectAllowed = 'move';
  });

  el.addEventListener('dragend', e => {
    e.target.style.opacity = '';
  });

  return el;
}

function addCard(columnId, text, inputEl) {
  if (!text) return;
  fetch(`${API_BASE}/api/cards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ columnId, text })
  })
    .then(res => res.json())
    .then(() => {
      inputEl.value = '';
    });
}

function setupSSE() {
  const es = new EventSource(`${API_BASE}/api/stream`);
  es.onmessage = e => {
    const data = JSON.parse(e.data);
    handleEvent(data);
  };
}

function handleEvent(event) {
  if (event.type === 'create') {
    const card = event.card;
    const colEl = document.querySelector(`.column[data-id='${card.column_id}'] .cards`);
    if (colEl) colEl.appendChild(createCardElement(card));
  } else if (event.type === 'move') {
    const card = event.card;
    const oldEl = document.querySelector(`.card[data-id='${card.id}']`);
    if (oldEl) oldEl.parentNode.removeChild(oldEl);
    const colEl = document.querySelector(`.column[data-id='${card.column_id}'] .cards`);
    if (colEl) colEl.appendChild(createCardElement(card));
  }
}

// Setup drop zones
function makeColumnsDroppable() {
  document.querySelectorAll('.cards').forEach(col => {
    col.addEventListener('dragover', e => e.preventDefault());
    col.addEventListener('drop', e => {
      e.preventDefault();
      const cardId = e.dataTransfer.getData('text/plain');
      const targetColId = col.dataset.columnId;
      // Move card within same column -> no before/after specified (append)
      moveCard(cardId, targetColId, null, null);
    });
  });
}

async function moveCard(cardId, columnId, beforeId, afterId) {
  await fetch(`${API_BASE}/api/cards/${cardId}/move`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ columnId, beforeId, afterId })
  });
}

window.onload = async () => {
  await fetchBoard();
  setupSSE();
  makeColumnsDroppable();
};

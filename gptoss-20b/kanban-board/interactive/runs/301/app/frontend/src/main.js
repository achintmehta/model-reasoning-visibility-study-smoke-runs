// Simple Kanban renderer
const API_BASE = 'http://localhost:3000/api';
let boardEl = document.getElementById('app');

async function fetchBoard() {
  const res = await fetch(`${API_BASE}/board`);
  return res.json();
}

function renderBoard(board) {
  boardEl.innerHTML = '';
  const boardDiv = document.createElement('div');
  boardDiv.id = 'board';
  board.forEach(col => {
    const colDiv = document.createElement('div');
    colDiv.className = 'column';
    const title = document.createElement('h2');
    title.textContent = col.title;
    colDiv.appendChild(title);
    const cardsDiv = document.createElement('div');
    cardsDiv.id = `cards-${col.id}`;
    col.cards.forEach(card => {
      const cardEl = createCardElement(card);
      cardsDiv.appendChild(cardEl);
    });
    colDiv.appendChild(cardsDiv);
    // Add card form
    const addForm = document.createElement('form');
    addForm.className = 'add-card';
    const input = document.createElement('input');
    input.type = 'text'; input.placeholder = 'New card...';
    const btn = document.createElement('button'); btn.type = 'submit'; btn.textContent = 'Add';
    addForm.appendChild(input); addForm.appendChild(btn);
    addForm.addEventListener('submit', async e => {e.preventDefault(); if(!input.value) return; await createCard(col.id, input.value); input.value=''; const newCard = await fetchBoard(); renderBoard(newCard); });
    colDiv.appendChild(addForm);
    boardDiv.appendChild(colDiv);
  });
  boardEl.appendChild(boardDiv);
}

async function createCard(columnId, text) {
  await fetch(`${API_BASE}/cards`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ columnId, text })
  });
}

function createCardElement(card) {
  const cardEl = document.createElement('div'); cardEl.className = 'card'; cardEl.draggable = true; cardEl.dataset.id = card.id; cardEl.textContent = card.text;
  // drag events
  cardEl.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', card.id); });
  return cardEl;
}

function addDragDropHandlers() {
  const board = document.getElementById('board');
  board.addEventListener('dragover', e => { e.preventDefault(); });
  board.addEventListener('drop', async e => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); const target = e.target.closest('.card, .column'); if (!target) return; const cardEl = document.querySelector(
      `div.card[data-id="${id}"]`
    ); const cardDiv = cardEl.parentElement; const column = target.closest('.column'); const columnId = column.querySelector('h2').innerText; // naive; in real use column id
    // For demo simply reorder within same column
    cardDiv.remove(); column.querySelector('.add-card').before(cardDiv); // broadcast move
    await fetch(`${API_BASE}/cards/${id}/move`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ columnId }) });
  });
}

async function start() {
  const board = await fetchBoard();
  renderBoard(board);
  addDragDropHandlers();
}
start();

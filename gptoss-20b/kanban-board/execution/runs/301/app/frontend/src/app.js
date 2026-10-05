"use strict";

const API_BASE = '/api';

export function initApp() {
  const appDiv = document.getElementById('app');
  renderBoard();
  startSSE();
}

async function fetchJSON(url, init = {}) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function renderBoard() {
  fetchJSON(`${API_BASE}/board`).then(board => {
    const app = document.getElementById('app');
    app.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'board';
    board.columns.forEach(col => {
      const colDiv = createColumn(col);
      container.appendChild(colDiv);
    });
    app.appendChild(container);
  }).catch(err => console.error(err));
}

function createColumn(col) {
  const colDiv = document.createElement('div');
  colDiv.className = 'column';
  colDiv.dataset.columnId = col.id;

  const title = document.createElement('h3');
  title.textContent = col.title;
  colDiv.appendChild(title);

  const list = document.createElement('ul');
  list.className = 'card-list';
  list.dataset.columnId = col.id;
  list.addEventListener('dragover', e => e.preventDefault());
  list.addEventListener('drop', handleDrop);
  col.cards.forEach(card => {
    const li = createCard(card);
    list.appendChild(li);
  });

  const form = document.createElement('form');
  form.className = 'add-card-form';
  form.innerHTML = `<input type="text" placeholder="New card" required><button type="submit">Add</button>`;
  form.addEventListener('submit', e => { e.preventDefault(); addCard(col.id, e.target[0].value); e.target[0].value=''; });

  colDiv.appendChild(list);
  colDiv.appendChild(form);

  return colDiv;
}

function createCard(card) {
  const li = document.createElement('li');
  li.className = 'card';
  li.textContent = card.text;
  li.draggable = true;
  li.dataset.cardId = card.id;
  li.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', card.id);
  });
  return li;
}

async function addCard(columnId, text) {
  await fetchJSON(`${API_BASE}/cards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ columnId, text })
  });
}

function handleDrop(e) {
  const cardId = e.dataTransfer.getData('text/plain');
  const targetList = e.currentTarget;
  const afterCard = e.target.closest('.card');
  const beforeCard = afterCard ? afterCard.nextElementSibling : null;
  const afterId = afterCard ? afterCard.dataset.cardId : null;
  const beforeId = beforeCard ? beforeCard.dataset.cardId : null;

  // Optimistic move
  const cardElem = document.querySelector(`.card[data-card-id="${cardId}"]`);
  if (!cardElem) return;
  targetList.appendChild(cardElem);

  if (afterId === beforeId) return; // no real change

  const payload = {
    columnId: targetList.dataset.columnId,
    beforeId,
    afterId
  };
  fetchJSON(`${API_BASE}/cards/${cardId}/move`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(err => console.error(err));
}

function startSSE() {
  const es = new EventSource(`${API_BASE}/stream`);
  es.addEventListener('message', e => {
    const data = JSON.parse(e.data);
    applyEvent(data);
  });
}

function applyEvent(evt) {
  if (evt.type === 'create') {
    const card = evt.card;
    const targetList = document.querySelector(`.card-list[data-column-id="${card.column_id}"]`);
    if (!targetList) return;
    const li = createCard(card);
    targetList.appendChild(li);
  } else if (evt.type === 'move') {
    const card = evt.card;
    const existing = document.querySelector(`.card[data-card-id="${card.id}"]`);
    if (!existing) return;
    const targetList = document.querySelector(`.card-list[data-column-id="${card.column_id}"]`);
    if (!targetList) return;
    // Remove from old parent
    existing.parentNode.removeChild(existing);
    targetList.appendChild(existing);
  }
}

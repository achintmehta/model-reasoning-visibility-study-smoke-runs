const API_BASE = 'http://localhost:3000/api';
let boardState = [];
const boardEl = document.getElementById('board');

async function fetchBoard() {
  const res = await fetch(`${API_BASE}/board`);
  boardState = await res.json();
  renderBoard();
}

function renderBoard() {
  boardEl.innerHTML = '';
  boardState.forEach(col => {
    const colEl = document.createElement('div');
    colEl.className = 'column';
    colEl.dataset.columnId = col.id;
    colEl.innerHTML = `
      <h2>${col.title}</h2>
      <div class="cards" data-column-id="${col.id}"></div>
      <div class="add-card">
        <input placeholder="New card..." data-add-input="${col.id}" />
        <button data-add-btn="${col.id}">Add</button>
      </div>
    `;
    const cardsContainer = colEl.querySelector('.cards');
    col.cards.forEach(card => {
      const cardEl = createCardElement(card);
      cardsContainer.appendChild(cardEl);
    });
    const input = colEl.querySelector(`[data-add-input="${col.id}"]`);
    const btn = colEl.querySelector(`[data-add-btn="${col.id}"]`);
    btn.addEventListener('click', () => addCard(col.id, input));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') addCard(col.id, input); });

    cardsContainer.addEventListener('dragover', e => {
      e.preventDefault();
      const afterElement = getDragAfterElement(cardsContainer, e.clientY);
      const draggable = document.querySelector('.dragging');
      if (draggable) {
        if (afterElement == null) {
          cardsContainer.appendChild(draggable);
        } else {
          cardsContainer.insertBefore(draggable, afterElement);
        }
      }
    });

    cardsContainer.addEventListener('drop', e => {
      e.preventDefault();
      const cardId = e.dataTransfer.getData('text/plain');
      const cardEl = document.getElementById(`card-${cardId}`);
      if (!cardEl) return;
      const afterElement = getDragAfterElement(cardsContainer, e.clientY);
      let beforeId = null;
      let afterId = null;
      if (afterElement) {
        afterId = afterElement.dataset.cardId;
        beforeId = getPrevCardId(afterElement);
      } else {
        const cards = [...cardsContainer.querySelectorAll('.card:not(.dragging)')];
        const last = cards[cards.length - 1];
        beforeId = last ? last.dataset.cardId : null;
        afterId = null;
      }
      if (afterElement == null) {
        cardsContainer.appendChild(cardEl);
      } else {
        cardsContainer.insertBefore(cardEl, afterElement);
      }
      moveCard(cardId, col.id, beforeId, afterId);
    });

    colEl.addEventListener('dragover', e => e.preventDefault());
    colEl.addEventListener('drop', e => {
      const cardId = e.dataTransfer.getData('text/plain');
      const cardEl = document.getElementById(`card-${cardId}`);
      if (!cardEl) return;
      const cardsContainer = colEl.querySelector('.cards');
      const cards = [...cardsContainer.querySelectorAll('.card:not(.dragging)')];
      const lastId = cards.length ? cards[cards.length - 1].dataset.cardId : null;
      cardsContainer.appendChild(cardEl);
      moveCard(cardId, col.id, lastId, null);
    });

    boardEl.appendChild(colEl);
  });
  setupDraggableCards();
}

function createCardElement(card) {
  const el = document.createElement('div');
  el.className = 'card';
  el.id = `card-${card.id}`;
  el.draggable = true;
  el.dataset.cardId = card.id;
  el.textContent = card.text;
  el.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', card.id);
    setTimeout(() => el.classList.add('dragging'), 0);
  });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));
  return el;
}

function setupDraggableCards() {
  document.querySelectorAll('.card').forEach(card => {
    if (!card.hasAttribute('data-drag-bound')) {
      card.setAttribute('data-drag-bound', '1');
      card.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', card.dataset.cardId);
        setTimeout(() => card.classList.add('dragging'), 0);
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
    }
  });
}

function getDragAfterElement(container, y) {
  const cards = [...container.querySelectorAll('.card:not(.dragging)')];
  return cards.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function getPrevCardId(element) {
  const prev = element.previousElementSibling;
  return prev ? prev.dataset.cardId : null;
}

async function addCard(columnId, inputEl) {
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = '';
  const tempId = 'temp-' + Math.random().toString(36).slice(2);
  const colEl = document.querySelector(`.column[data-column-id="${columnId}"]`);
  const cardsContainer = colEl.querySelector('.cards');
  const tempCardEl = createCardElement({ id: tempId, text });
  cardsContainer.appendChild(tempCardEl);
  try {
    const res = await fetch(`${API_BASE}/cards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columnId, text })
    });
    const card = await res.json();
    const existing = document.getElementById(`card-${tempId}`);
    if (existing) existing.remove();
    const newEl = createCardElement(card);
    cardsContainer.appendChild(newEl);
  } catch (e) {
    console.error(e);
    document.getElementById(`card-${tempId}`)?.remove();
  }
}

async function moveCard(cardId, columnId, beforeId, afterId) {
  try {
    await fetch(`${API_BASE}/cards/${cardId}/move`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columnId, beforeId, afterId })
    });
  } catch (e) {
    console.error(e);
    fetchBoard();
  }
}

let eventSource = null;
function connectSSE() {
  eventSource = new EventSource(`${API_BASE}/stream`);
  eventSource.addEventListener('card-created', e => {
    const { card } = JSON.parse(e.data);
    const col = boardState.find(c => c.id === card.columnId);
    if (col) {
      if (!col.cards.find(c => c.id === card.id)) {
        col.cards.push(card);
        col.cards.sort((a,b) => a.position - b.position);
        renderBoard();
      }
    } else {
      fetchBoard();
    }
  });
  eventSource.addEventListener('card-moved', e => {
    const { card } = JSON.parse(e.data);
    for (const col of boardState) {
      const idx = col.cards.findIndex(c => c.id === card.id);
      if (idx !== -1) {
        col.cards.splice(idx, 1);
        break;
      }
    }
    const targetCol = boardState.find(c => c.id === card.columnId);
    if (targetCol) {
      targetCol.cards = targetCol.cards.filter(c => c.id !== card.id);
      targetCol.cards.push(card);
      targetCol.cards.sort((a,b) => a.position - b.position);
    }
    renderBoard();
  });
  eventSource.addEventListener('cards-renormalized', e => {
    const { columnId, cards } = JSON.parse(e.data);
    const col = boardState.find(c => c.id === columnId);
    if (col) {
      col.cards = cards;
      renderBoard();
    }
  });
  eventSource.onerror = () => {
    console.warn('SSE error, retrying...');
    eventSource.close();
    setTimeout(connectSSE, 3000);
  };
}

fetchBoard().then(connectSSE);

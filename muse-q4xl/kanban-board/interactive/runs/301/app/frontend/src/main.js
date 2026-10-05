const API_BASE = '/api';
let boardState = [];

// DOM
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

    const header = document.createElement('h2');
    header.textContent = col.title;
    colEl.appendChild(header);

    const cardsContainer = document.createElement('div');
    cardsContainer.className = 'cards';
    cardsContainer.dataset.columnId = col.id;
    cardsContainer.addEventListener('dragover', handleDragOver);
    cardsContainer.addEventListener('drop', (e) => handleDrop(e, col.id, null));
    colEl.appendChild(cardsContainer);

    col.cards.forEach(card => {
      const cardEl = createCardElement(card);
      cardsContainer.appendChild(cardEl);
    });

    // Add card UI
    const addDiv = document.createElement('div');
    addDiv.className = 'add-card';
    const input = document.createElement('input');
    input.placeholder = 'Add card';
    const btn = document.createElement('button');
    btn.textContent = 'Add';
    btn.onclick = async () => {
      const text = input.value.trim();
      if (!text) return;
      await createCard(col.id, text);
      input.value = '';
    };
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        const text = input.value.trim();
        if (!text) return;
        await createCard(col.id, text);
        input.value = '';
      }
    });
    addDiv.appendChild(input);
    addDiv.appendChild(btn);
    colEl.appendChild(addDiv);

    boardEl.appendChild(colEl);
  });
}

function createCardElement(card) {
  const el = document.createElement('div');
  el.className = 'card';
  el.draggable = true;
  el.dataset.cardId = card.id;
  el.textContent = card.text;

  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', card.id);
    el.classList.add('dragging');
    // Store source column
    const columnEl = el.closest('.column');
    e.dataTransfer.setData('source-column', columnEl.dataset.columnId);
  });
  el.addEventListener('dragend', () => {
    el.classList.remove('dragging');
  });

  // For drop between cards
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    // visual hint could be added
  });
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    const cardId = e.dataTransfer.getData('text/plain');
    const sourceColumnId = e.dataTransfer.getData('source-column');
    const targetColumnId = el.closest('.column').dataset.columnId;
    const beforeId = el.dataset.cardId;
    handleMove(cardId, sourceColumnId, targetColumnId, beforeId, null);
  });

  return el;
}

async function createCard(columnId, text) {
  // Optimistic UI: create temporary card
  const col = boardState.find(c => c.id === Number(columnId));
  if (col) {
    const tempCard = { id: 'temp-' + Date.now(), text, position: 999999, column_id: columnId };
    col.cards.push(tempCard);
    renderColumn(col);
  }
  const res = await fetch(`${API_BASE}/cards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ columnId: Number(columnId), text })
  });
  if (!res.ok) {
    // Revert on error
    fetchBoard();
  }
  // SSE will reconcile
}

function handleDragOver(e) {
  e.preventDefault();
}

async function handleDrop(e, columnId, beforeId) {
  e.preventDefault();
  const cardId = e.dataTransfer.getData('text/plain');
  const sourceColumnId = e.dataTransfer.getData('source-column');
  // Determine afterId: if drop on container, beforeId is null, afterId null
  // If drop on card, beforeId is target card id
  // For simplicity, we compute afterId by looking at next sibling
  const targetCard = e.target.closest('.card');
  let before = beforeId;
  let after = null;
  if (targetCard) {
    before = targetCard.dataset.cardId;
    // after is next sibling
    const next = targetCard.nextElementSibling;
    if (next && next.classList.contains('card')) {
      after = next.dataset.cardId;
    }
  }
  handleMove(cardId, sourceColumnId, columnId, before, after);
}

async function handleMove(cardId, sourceColumnId, targetColumnId, beforeId, afterId) {
  // Optimistic DOM move
  const cardEl = document.querySelector(`.card[data-card-id="${cardId}"]`);
  if (!cardEl) return;
  const targetContainer = document.querySelector(`.cards[data-column-id="${targetColumnId}"]`);
  if (!targetContainer) return;

  // Remove from current
  cardEl.remove();
  // Insert at correct position
  if (beforeId) {
    const beforeEl = targetContainer.querySelector(`.card[data-card-id="${beforeId}"]`);
    if (beforeEl) {
      targetContainer.insertBefore(cardEl, beforeEl);
    } else {
      targetContainer.appendChild(cardEl);
    }
  } else if (afterId) {
    const afterEl = targetContainer.querySelector(`.card[data-card-id="${afterId}"]`);
    if (afterEl && afterEl.nextSibling) {
      targetContainer.insertBefore(cardEl, afterEl.nextSibling);
    } else {
      targetContainer.appendChild(cardEl);
    }
  } else {
    // append
    targetContainer.appendChild(cardEl);
  }

  // Send request
  try {
    const res = await fetch(`${API_BASE}/cards/${cardId}/move`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        columnId: Number(targetColumnId),
        beforeId: beforeId ? Number(beforeId) : null,
        afterId: afterId ? Number(afterId) : null
      })
    });
    if (!res.ok) {
      // Revert on error by refetching board
      fetchBoard();
    }
  } catch (err) {
    fetchBoard();
  }
}

// SSE
const eventSource = new EventSource(`${API_BASE}/stream`);
eventSource.onmessage = (e) => {
  // default message
};
eventSource.addEventListener('card-created', (e) => {
  const { card, columnId } = JSON.parse(e.data);
  updateBoardStateOnCreate(card, columnId);
});
eventSource.addEventListener('card-moved', (e) => {
  const { card, fromColumnId, toColumnId } = JSON.parse(e.data);
  updateBoardStateOnMove(card, fromColumnId, toColumnId);
});
eventSource.addEventListener('column-reordered', (e) => {
  const { columnId, cards } = JSON.parse(e.data);
  updateColumnCards(columnId, cards);
});

function updateBoardStateOnCreate(card, columnId) {
  const col = boardState.find(c => c.id === Number(columnId));
  if (!col) {
    fetchBoard();
    return;
  }
  // Avoid duplicate
  if (!col.cards.find(c => c.id === card.id)) {
    col.cards.push(card);
    // Re-render column
    renderColumn(col);
  }
}

function updateBoardStateOnMove(card, fromColumnId, toColumnId) {
  // Remove from old
  const fromCol = boardState.find(c => c.id === Number(fromColumnId));
  const toCol = boardState.find(c => c.id === Number(toColumnId));
  if (fromCol) {
    fromCol.cards = fromCol.cards.filter(c => c.id !== card.id);
  }
  if (toCol) {
    // Remove existing
    toCol.cards = toCol.cards.filter(c => c.id !== card.id);
    // Insert at correct position based on position
    const idx = toCol.cards.findIndex(c => Number(c.position) > Number(card.position));
    if (idx === -1) {
      toCol.cards.push(card);
    } else {
      toCol.cards.splice(idx, 0, card);
    }
    renderColumn(toCol);
  }
  if (fromCol && fromCol.id !== toCol?.id) {
    renderColumn(fromCol);
  }
}

function updateColumnCards(columnId, cards) {
  const col = boardState.find(c => c.id === Number(columnId));
  if (col) {
    col.cards = cards;
    renderColumn(col);
  }
}

function renderColumn(col) {
  const colEl = document.querySelector(`.column[data-column-id="${col.id}"]`);
  if (!colEl) return;
  const cardsContainer = colEl.querySelector('.cards');
  cardsContainer.innerHTML = '';
  col.cards.forEach(card => {
    cardsContainer.appendChild(createCardElement(card));
  });
}

// Initial load
fetchBoard();

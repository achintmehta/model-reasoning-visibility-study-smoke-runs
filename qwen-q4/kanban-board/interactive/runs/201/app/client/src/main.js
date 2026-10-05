// State
let boardState = { columns: {}, cards: {} };
let draggedCardId = null;
let dropIndicator = null;
let eventSource = null;

// API helpers
const API_BASE = '/api';

async function fetchBoard() {
  const res = await fetch(`${API_BASE}/board`);
  if (!res.ok) throw new Error('Failed to fetch board');
  return res.json();
}

async function createCard(columnId, text) {
  const res = await fetch(`${API_BASE}/cards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ columnId, text }),
  });
  if (!res.ok) throw new Error('Failed to create card');
  return res.json();
}

async function moveCard(cardId, columnId, beforeId, afterId) {
  const res = await fetch(`${API_BASE}/cards/${cardId}/move`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ columnId, beforeId, afterId }),
  });
  if (!res.ok) throw new Error('Failed to move card');
  return res.json();
}

// DOM helpers
function getColumnEl(columnId) {
  return document.querySelector(`[data-column-id="${columnId}"]`);
}

function getCardListEl(columnId) {
  return getColumnEl(columnId).querySelector('.card-list');
}

function getCardEl(cardId) {
  return document.querySelector(`[data-card-id="${cardId}"]`);
}

function createCardEl(card) {
  const el = document.createElement('div');
  el.className = 'card';
  el.setAttribute('draggable', 'true');
  el.dataset.cardId = card.id;
  el.textContent = card.text;

  el.addEventListener('dragstart', handleDragStart);
  el.addEventListener('dragend', handleDragEnd);

  return el;
}

function createColumnEl(column) {
  const colEl = document.createElement('div');
  colEl.className = 'column';
  colEl.dataset.columnId = column.id;

  const header = document.createElement('div');
  header.className = 'column-header';
  header.textContent = column.title;
  colEl.appendChild(header);

  const cardList = document.createElement('div');
  cardList.className = 'card-list';
  cardList.dataset.columnId = column.id;

  cardList.addEventListener('dragover', handleDragOver);
  cardList.addEventListener('dragleave', handleDragLeave);
  cardList.addEventListener('drop', handleDrop);

  colEl.appendChild(cardList);

  // Add card form
  const addLink = document.createElement('div');
  addLink.className = 'add-card-link';
  addLink.textContent = '+ Add a card';
  addLink.addEventListener('click', () => showAddForm(colEl, addLink));
  colEl.appendChild(addLink);

  return colEl;
}

function showAddForm(colEl, addLink) {
  addLink.style.display = 'none';

  const form = document.createElement('div');
  form.className = 'add-card-form';

  const textarea = document.createElement('textarea');
  textarea.placeholder = 'Enter a title for this card...';

  const btnContainer = document.createElement('div');
  const submitBtn = document.createElement('button');
  submitBtn.textContent = 'Add card';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'cancel-btn';
  cancelBtn.textContent = '×';

  const columnId = colEl.dataset.columnId;

  async function submit() {
    const text = textarea.value.trim();
    if (!text) return;
    textarea.value = '';

    // Optimistically add to DOM
    const optimisticCard = {
      id: 'temp-' + Date.now(),
      column_id: columnId,
      text,
      position: 999999,
      created_at: new Date().toISOString(),
    };
    const cardEl = createCardEl(optimisticCard);
    getCardListEl(columnId).appendChild(cardEl);

    try {
      const serverCard = await createCard(columnId, text);
      // Replace optimistic card with server card
      cardEl.remove();
      const realCardEl = createCardEl(serverCard);
      getCardListEl(columnId).appendChild(realCardEl);
      boardState.cards[serverCard.id] = serverCard;
    } catch (err) {
      console.error('Failed to create card:', err);
      cardEl.remove();
      // Re-fetch board to reconcile
      await refreshBoard();
    }

    hideAddForm(colEl, form, addLink);
  }

  submitBtn.addEventListener('click', submit);
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });

  cancelBtn.addEventListener('click', () => hideAddForm(colEl, form, addLink));

  btnContainer.appendChild(submitBtn);
  btnContainer.appendChild(cancelBtn);
  form.appendChild(textarea);
  form.appendChild(btnContainer);

  colEl.insertBefore(form, addLink);
  textarea.focus();
}

function hideAddForm(colEl, form, addLink) {
  if (form.parentNode) form.remove();
  addLink.style.display = '';
}

// Drag and drop handlers
function handleDragStart(e) {
  draggedCardId = e.target.dataset.cardId;
  e.target.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', draggedCardId);

  // Create drop indicator
  dropIndicator = document.createElement('div');
  dropIndicator.className = 'drop-indicator';
}

function handleDragEnd(e) {
  e.target.classList.remove('dragging');
  draggedCardId = null;
  removeDropIndicator();
  document.querySelectorAll('.card-list.drag-over').forEach(el => el.classList.remove('drag-over'));
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  const cardList = e.currentTarget;
  cardList.classList.add('drag-over');

  const afterElement = getDragAfterElement(cardList, e.clientY);
  removeDropIndicator();

  if (afterElement == null) {
    cardList.appendChild(dropIndicator);
  } else {
    cardList.insertBefore(dropIndicator, afterElement);
  }
}

function handleDragLeave(e) {
  const cardList = e.currentTarget;
  // Only remove if we actually left the cardList
  if (!cardList.contains(e.relatedTarget)) {
    cardList.classList.remove('drag-over');
  }
}

function handleDrop(e) {
  e.preventDefault();
  const cardList = e.currentTarget;
  cardList.classList.remove('drag-over');
  removeDropIndicator();

  if (!draggedCardId) return;

  const targetColumnId = cardList.dataset.columnId;
  const afterElement = getDragAfterElement(cardList, e.clientY);

  // Determine beforeId and afterId based on drop position
  let beforeId = null;
  let afterId = null;

  if (afterElement == null) {
    // Dropped at the end
    const cardEls = [...cardList.querySelectorAll('.card:not(.dragging)')];
    if (cardEls.length > 0) {
      afterId = cardEls[cardEls.length - 1].dataset.cardId;
    }
  } else {
    // Dropped before afterElement
    beforeId = afterElement.dataset.cardId;
    const cardEls = [...cardList.querySelectorAll('.card:not(.dragging)')];
    const idx = cardEls.indexOf(afterElement);
    if (idx > 0) {
      afterId = cardEls[idx - 1].dataset.cardId;
    }
  }

  // Optimistically move card in DOM
  const cardEl = getCardEl(draggedCardId);
  if (cardEl) {
    cardEl.classList.remove('dragging');

    // Remove from old position
    cardEl.remove();

    // Insert at new position
    if (afterElement == null) {
      cardList.appendChild(cardEl);
    } else {
      cardList.insertBefore(cardEl, afterElement);
    }
  }

  // Send to server
  moveCard(draggedCardId, targetColumnId, beforeId, afterId).catch((err) => {
    console.error('Failed to move card:', err);
    // Re-fetch board to reconcile
    refreshBoard();
  });
}

function getDragAfterElement(container, y) {
  const cardElements = [...container.querySelectorAll('.card:not(.dragging)')];

  return cardElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function removeDropIndicator() {
  if (dropIndicator && dropIndicator.parentNode) {
    dropIndicator.remove();
  }
  dropIndicator = null;
}

// SSE handling
function connectSSE() {
  eventSource = new EventSource(`${API_BASE}/stream`);

  eventSource.addEventListener('connected', () => {
    console.log('SSE connected');
  });

  eventSource.addEventListener('card_created', (e) => {
    const data = JSON.parse(e.data);
    const card = data.card;
    const columnId = data.columnId;

    boardState.cards[card.id] = card;

    const cardList = getCardListEl(columnId);
    if (!cardList) return;

    const cardEl = createCardEl(card);

    // Insert in correct position
    const existingCards = [...cardList.querySelectorAll('.card')];
    const existingPositions = existingCards.map(el => ({
      el,
      pos: boardState.cards[el.dataset.cardId]?.position ?? 0,
    }));

    let inserted = false;
    for (const { el, pos } of existingPositions) {
      if (pos > card.position) {
        cardList.insertBefore(cardEl, el);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      cardList.appendChild(cardEl);
    }
  });

  eventSource.addEventListener('card_moved', (e) => {
    const data = JSON.parse(e.data);
    const card = data.card;
    const columnId = data.columnId;

    boardState.cards[card.id] = card;

    // Update the card element
    const cardEl = getCardEl(card.id);
    if (!cardEl) return;

    const cardList = getCardListEl(columnId);
    if (!cardList) return;

    // Remove from current position
    cardEl.remove();

    // Re-insert in correct position
    const existingCards = [...cardList.querySelectorAll('.card')];
    const existingPositions = existingCards.map(el => ({
      el,
      pos: boardState.cards[el.dataset.cardId]?.position ?? 0,
    }));

    let inserted = false;
    for (const { el, pos } of existingPositions) {
      if (pos > card.position) {
        cardList.insertBefore(cardEl, el);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      cardList.appendChild(cardEl);
    }
  });

  eventSource.addEventListener('card_deleted', (e) => {
    const data = JSON.parse(e.data);
    const cardId = data.cardId;

    delete boardState.cards[cardId];

    const cardEl = getCardEl(cardId);
    if (cardEl) cardEl.remove();
  });

  eventSource.addEventListener('column_renormalized', (e) => {
    const data = JSON.parse(e.data);
    const columnId = data.columnId;
    const cards = data.cards;

    // Update state
    for (const card of cards) {
      boardState.cards[card.id] = card;
    }

    // Re-render the column
    const cardList = getCardListEl(columnId);
    if (!cardList) return;

    cardList.innerHTML = '';
    const sortedCards = [...cards].sort((a, b) => a.position - b.position);
    for (const card of sortedCards) {
      const cardEl = createCardEl(card);
      cardList.appendChild(cardEl);
    }
  });

  eventSource.onerror = () => {
    console.warn('SSE connection error, reconnecting...');
    eventSource.close();
    setTimeout(connectSSE, 3000);
  };
}

// Render
async function renderBoard() {
  const board = await fetchBoard();
  const boardEl = document.getElementById('board');
  boardEl.innerHTML = '';

  boardState.columns = {};
  boardState.cards = {};

  for (const col of board) {
    boardState.columns[col.id] = col;

    const colEl = createColumnEl(col);
    boardEl.appendChild(colEl);

    const cardList = getCardListEl(col.id);
    const sortedCards = [...col.cards].sort((a, b) => a.position - b.position);

    for (const card of sortedCards) {
      boardState.cards[card.id] = card;
      const cardEl = createCardEl(card);
      cardList.appendChild(cardEl);
    }
  }
}

async function refreshBoard() {
  await renderBoard();
}

// Init
async function init() {
  await renderBoard();
  connectSSE();
}

init();

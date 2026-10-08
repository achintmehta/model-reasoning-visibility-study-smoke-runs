import './style.css';

const API_BASE = 'http://localhost:3001/api';
const SSE_URL = 'http://localhost:3001/api/stream';

let boardState = [];

const boardEl = document.getElementById('board');

async function fetchBoard() {
  const res = await fetch(`${API_BASE}/board`);
  boardState = await res.json();
  renderBoard();
}

function renderBoard() {
  boardEl.innerHTML = '';
  boardState.forEach(column => {
    const columnEl = document.createElement('div');
    columnEl.className = 'column';
    columnEl.dataset.id = column.id;
    
    const title = document.createElement('h2');
    title.textContent = column.title;
    columnEl.appendChild(title);

    const cardsContainer = document.createElement('div');
    cardsContainer.className = 'cards-container';
    cardsContainer.dataset.columnId = column.id;
    
    // Drag and drop handlers for the container
    cardsContainer.addEventListener('dragover', handleDragOver);
    cardsContainer.addEventListener('drop', handleDrop);

    column.cards.forEach(card => {
      const cardEl = createCardElement(card);
      cardsContainer.appendChild(cardEl);
    });

    columnEl.appendChild(cardsContainer);

    // Add card form
    const form = document.createElement('div');
    form.className = 'add-card-form';
    const input = document.createElement('input');
    input.placeholder = 'New card...';
    const btn = document.createElement('button');
    btn.textContent = 'Add';
    btn.onclick = () => createCard(column.id, input.value);
    input.onkeydown = (e) => { if (e.key === 'Enter') { createCard(column.id, input.value); input.value = ''; } };
    
    form.appendChild(input);
    form.appendChild(btn);
    columnEl.appendChild(form);

    boardEl.appendChild(columnEl);
  });
}

function createCardElement(card) {
  const el = document.createElement('div');
  el.className = 'card';
  el.textContent = card.text;
  el.draggable = true;
  el.dataset.id = card.id;
  
  el.addEventListener('dragstart', handleDragStart);
  el.addEventListener('dragend', handleDragEnd);
  
  return el;
}

let draggedCardId = null;

function handleDragStart(e) {
  draggedCardId = e.target.dataset.id;
  e.target.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd(e) {
  e.target.classList.remove('dragging');
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

async function handleDrop(e) {
  e.preventDefault();
  const cardsContainer = e.target.closest('.cards-container');
  if (!cardsContainer) return;

  const targetColumnId = cardsContainer.dataset.columnId;
  
  // Find the card that was dropped
  const cardEl = document.querySelector(`.card[data-id="${draggedCardId}"]`);
  if (!cardEl) return;

  // To implement reordering, we need to know where it was dropped.
  // We'll use the position of the card we dropped it after/before.
  
  // Get all cards in the target container to determine order
  const children = Array.from(cardsContainer.children);
  const dropTargetIndex = children.findIndex(child => child !== cardEl && child.contains(e.target) || e.target === child);
  
  // Actually, let's simplify: find which card it's being dropped near
  let beforeId = null;
  let afterId = null;

  // Let's try to find the card we are dropping it after/before
  // A better way to do this is to find the element underneath the mouse
  const elementUnderMouse = document.elementFromPoint(e.clientX, e.clientY);
  const cardUnderMouse = elementUnderMouse?.closest('.card');

  if (cardUnderMouse && cardUnderMouse.dataset.id !== draggedCardId) {
    // Dropped after or before another card
    // For simplicity, let's say we drop it AFTER the card under the mouse.
    // Or we can check if it's the top or bottom half of the card.
    const rect = cardUnderMouse.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    
    if (e.clientY < midpoint) {
      // Before cardUnderMouse
      afterId = cardUnderMouse.dataset.id;
      beforeId = null;
    } else {
      // After cardUnderMouse
      beforeId = cardUnderMouse.dataset.id;
      afterId = null;
    }
  } else if (cardUnderMouse === null) {
     // Dropped on the container but not on a card
     // It might be at the end
  }

  // Re-evaluating drop logic:
  // Let's get the cards in the container
  const containerCards = Array.from(cardsContainer.children);
  const index = containerCards.findIndex(c => c.dataset.id === cardUnderMouse?.dataset.id);
  
  // This is getting complicated. Let's simplify:
  // Just find the element we are dropping on.
  
  // Actually, if we drop on a card, we can decide if it's before or after.
  // If we drop on empty space in the container, it's at the end.

  // Let's use a simpler approach for the MVP:
  // find the card we are dropping on.
  // If we drop on a card, we'll put it after it.
  // If we drop on the container but not a card, we'll put it at the end.

  // BUT the requirement says "reorder them within a column".
  // So we need a better way.

  // Let's use the children of the container.
  let newBeforeId = null;
  let newAfterId = null;

  if (cardUnderMouse && cardUnderMouse.dataset.id !== draggedCardId) {
    // Dropped on a card. Let's decide if it's before or after based on mouse position.
    const rect = cardUnderMouse.getBoundingClientRect();
    const isAfter = (e.clientY - rect.top) > (rect.height / 2);
    if (isAfter) {
      newBeforeId = cardUnderMouse.dataset.id;
    } else {
      newAfterId = cardUnderMouse.dataset.id;
    }
  } else {
    // Dropped on container (not on a card) or on the container itself.
    // We need to find which card it's after.
    // This is tricky with just e.clientY.
    // Let's find the closest card above the drop point.
    const allCardsInContainer = Array.from(cardsContainer.children);
    let closestCard = null;
    let minY = Infinity;
    
    for (const c of allCardsInContainer) {
      if (c.dataset.id === draggedCardId) continue;
      const rect = c.getBoundingClientRect();
      if (rect.top <= e.clientY && rect.top < minY) {
        minY = rect.top;
        closestCard = c;
      }
    }
    
    if (closestCard) {
      newBeforeId = closestCard.dataset.id;
    }
  }

  // Now perform the optimistic update
  // 1. Find the card in current state
  const cardToMove = findCardInState(draggedCardId);
  if (!cardToMove) return;

  // 2. Move it in state
  const oldColumnId = cardToMove.column_id;
  const oldPosition = cardToMove.position;

  // Optimistic UI: Move the DOM element immediately
  const el = document.querySelector(`.card[data-id="${draggedCardId}"]`);
  if (cardUnderMouse && cardUnderMouse.dataset.id !== draggedCardId) {
    const rect = cardUnderMouse.getBoundingClientRect();
    const isAfter = (e.clientY - rect.top) > (rect.height / 2);
    if (isAfter) {
      cardsContainer.appendChild(el);
    } else {
      cardsContainer.insertBefore(el, cardUnderMouse);
    }
  } else {
    cardsContainer.appendChild(el);
  }

  // 3. Send to server
  try {
    const res = await fetch(`${API_BASE}/cards/${draggedCardId}/move`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        columnId: targetColumnId,
        beforeId: newBeforeId,
        afterId: newAfterId
      })
    });

    if (!res.ok) {
      throw new Error('Failed to move card');
    }
    // On success, we don't necessarily need to do anything because SSE will sync it,
    // but the server returns the canonical card.
    const updatedCard = await res.json();
    reconcileCard(updatedCard);
  } catch (err) {
    console.error(err);
    // On error, rollback
    fetchBoard();
  }
}

function findCardInState(id) {
  for (const col of boardState) {
    const card = col.cards.find(c => c.id === id);
    if (card) return card;
  }
  return null;
}

async function createCard(columnId, text) {
  if (!text) return;

  // Find the input element to clear it later
  const columnEl = boardState.find(c => c.id === columnId)?.el; // This won't work, I don't store el in state
  // Let's just find it in the DOM
  const input = document.querySelector(`.column[data-id="${columnId}"] .add-card-form input`);

  // Optimistic update: add a placeholder card
  const tempId = `temp-${Date.now()}`;
  const newCard = { id: tempId, column_id: columnId, text, position: 0 };
  
  const col = boardState.find(c => c.id === columnId);
  if (col) {
    col.cards.push(newCard);
    renderBoard();
  }

  try {
    const res = await fetch(`${API_BASE}/cards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columnId, text })
    });

    if (!res.ok) throw new Error('Failed to create card');
    const canonicalCard = await res.json();
    reconcileCard(canonicalCard);
  } catch (err) {
    console.error(err);
    fetchBoard();
  } finally {
    if (input) input.value = '';
  }
}

function reconcileCard(canonicalCard) {
  // Replace the optimistic card with the canonical one
  // First, remove any card with the same ID (the optimistic one)
  boardState.forEach(col => {
    col.cards = col.cards.filter(c => c.id !== canonicalCard.id);
  });

  // Add the canonical card to its column
  const col = boardState.find(c => c.id === canonicalCard.column_id);
  if (col) {
    col.cards.push(canonicalCard);
    // Re-sort cards in the column by position
    col.cards.sort((a, b) => a.position - b.position);
  }

  renderBoard();
}

function setupSSE() {
  const eventSource = new EventSource(SSE_URL);

  eventSource.onmessage = (event) => {
    const { type, data } = JSON.parse(event.data);
    console.log('SSE message:', type, data);

    if (type === 'CARD_CREATED' || type === 'CARD_MOVED') {
      reconcileCard(data);
    }
  };

  eventSource.onerror = (err) => {
    console.error('SSE error:', err);
    eventSource.close();
    // Retry after a delay
    setTimeout(setupSSE, 5000);
  };
}

// Initial load
fetchBoard();
setupSSE();

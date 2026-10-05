import './style.css';

// State
let boardState = null;
let cardIdMap = new Map(); // Map card ID to DOM element
let optimisticUpdates = new Map(); // Map card ID to optimistic state

// DOM elements
const boardEl = document.getElementById('board');
const eventSource = new EventSource('/api/stream');

// Initialize
async function init() {
  await loadBoard();
  setupEventSource();
  setupDragAndDrop();
}

// Load board state
async function loadBoard() {
  try {
    const response = await fetch('/api/board');
    if (!response.ok) throw new Error('Failed to load board');
    
    boardState = await response.json();
    renderBoard();
  } catch (error) {
    console.error('Error loading board:', error);
    boardEl.innerHTML = '<p class="error">Failed to load board. Please refresh the page.</p>';
  }
}

// Render board
function renderBoard() {
  boardEl.innerHTML = '';
  
  boardState.columns.forEach(column => {
    const columnEl = createColumnElement(column);
    boardEl.appendChild(columnEl);
  });
}

// Create column element
function createColumnElement(column) {
  const colEl = document.createElement('div');
  colEl.className = 'column';
  colEl.dataset.columnId = column.id;
  colEl.dataset.columnTitle = column.title;
  
  const titleEl = document.createElement('h2');
  titleEl.className = 'column-title';
  titleEl.textContent = column.title;
  colEl.appendChild(titleEl);
  
  const cardsContainer = document.createElement('div');
  cardsContainer.className = 'cards-container';
  cardsContainer.dataset.columnId = column.id;
  
  column.cards.forEach(card => {
    const cardEl = createCardElement(card);
    cardsContainer.appendChild(cardEl);
    cardIdMap.set(card.id, cardEl);
    optimisticUpdates.set(card.id, card);
  });
  
  colEl.appendChild(cardsContainer);
  
  const addInput = document.createElement('input');
  addInput.type = 'text';
  addInput.placeholder = `Add task to ${column.title}...`;
  addInput.className = 'add-card-input';
  addInput.dataset.columnId = column.id;
  colEl.appendChild(addInput);
  
  const addButton = document.createElement('button');
  addButton.className = 'add-card-button';
  addButton.textContent = 'Add';
  addButton.dataset.columnId = column.id;
  colEl.appendChild(addButton);
  
  return colEl;
}

// Create card element
function createCardElement(card) {
  const cardEl = document.createElement('div');
  cardEl.className = 'card';
  cardEl.dataset.cardId = card.id;
  cardEl.dataset.columnId = card.column_id;
  cardEl.dataset.position = card.position;
  cardEl.textContent = card.text;
  cardEl.draggable = true;
  
  // Add drag events
  cardEl.addEventListener('dragstart', handleDragStart);
  cardEl.addEventListener('dragend', handleDragEnd);
  
  return cardEl;
}

// Setup EventSource for SSE
function setupEventSource() {
  eventSource.addEventListener('message', (event) => {
    try {
      const data = JSON.parse(event.data);
      handleSSEEvent(data);
    } catch (error) {
      console.error('Error parsing SSE event:', error);
    }
  });
  
  eventSource.onerror = (error) => {
    console.error('SSE error:', error);
    // Reconnect after 5 seconds
    setTimeout(() => {
      eventSource.close();
      setupEventSource();
    }, 5000);
  };
}

// Handle SSE events
function handleSSEEvent(event) {
  if (event.type === 'card-created') {
    handleCardCreated(event.card);
  } else if (event.type === 'card-moved') {
    handleCardMoved(event.card);
  }
}

// Handle card created event
async function handleCardCreated(card) {
  const columnEl = document.querySelector(
    `.card[data-column-id="${card.column_id}"]`?.closest('.column')
  );
  
  if (columnEl) {
    const cardsContainer = columnEl.querySelector('.cards-container');
    const cardEl = createCardElement(card);
    
    // Find correct position
    const siblings = Array.from(cardsContainer.children)
      .filter(el => el.classList.contains('card'))
      .sort((a, b) => {
        const posA = parseFloat(a.dataset.position);
        const posB = parseFloat(b.dataset.position);
        return posA - posB;
      });
    
    const insertAfter = siblings.find(s => parseFloat(s.dataset.position) > card.position);
    if (insertAfter) {
      cardsContainer.insertBefore(cardEl, insertAfter.nextSibling);
    } else {
      cardsContainer.appendChild(cardEl);
    }
    
    cardIdMap.set(card.id, cardEl);
    optimisticUpdates.set(card.id, card);
    
    // Re-sort all cards in this column
    renderColumnCards(columnEl);
  }
}

// Handle card moved event
async function handleCardMoved(card) {
  const oldColumnEl = document.querySelector(
    `.card[data-card-id="${card.id}"]`?.closest('.column')
  );
  const newColumnEl = document.querySelector(`.column[data-column-id="${card.column_id}"]`);
  
  const cardEl = cardIdMap.get(card.id);
  
  if (newColumnEl) {
    const cardsContainer = newColumnEl.querySelector('.cards-container');
    
    // Remove from old position
    if (cardEl && oldColumnEl) {
      cardEl.remove();
      cardIdMap.delete(card.id);
    }
    
    // Find correct position
    const siblings = Array.from(cardsContainer.children)
      .filter(el => el.classList.contains('card'))
      .sort((a, b) => {
        const posA = parseFloat(a.dataset.position);
        const posB = parseFloat(b.dataset.position);
        return posA - posB;
      });
    
    const insertAfter = siblings.find(s => parseFloat(s.dataset.position) > card.position);
    if (insertAfter) {
      cardsContainer.insertBefore(createCardElement(card), insertAfter.nextSibling);
    } else {
      cardsContainer.appendChild(createCardElement(card));
    }
    
    cardIdMap.set(card.id, createCardElement(card));
    optimisticUpdates.set(card.id, card);
    
    // Re-sort all cards in this column
    renderColumnCards(newColumnEl);
  }
}

// Render cards in a column (re-sort)
function renderColumnCards(columnEl) {
  const cardsContainer = columnEl.querySelector('.cards-container');
  const cards = Array.from(cardsContainer.children)
    .filter(el => el.classList.contains('card'))
    .sort((a, b) => {
      const posA = parseFloat(a.dataset.position);
      const posB = parseFloat(b.dataset.position);
      return posA - posB;
    });
  
  cards.forEach((card, index) => {
    cardsContainer.appendChild(card);
  });
}

// Setup drag and drop
let draggedCard = null;
let dragSourceColumn = null;

function setupDragAndDrop() {
  boardEl.addEventListener('dragover', handleDragOver);
  boardEl.addEventListener('drop', handleDrop);
  
  // Setup add card buttons
  boardEl.addEventListener('click', handleAddCardClick);
  
  // Setup add card form submission
  boardEl.addEventListener('submit', handleAddCardSubmit);
}

function handleDragStart(e) {
  draggedCard = e.target;
  dragSourceColumn = e.target.closest('.column');
  e.target.style.opacity = '0.5';
  e.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd(e) {
  e.target.style.opacity = '1';
  draggedCard = null;
  dragSourceColumn = null;
  
  // Remove all drop indicators
  document.querySelectorAll('.drop-indicator').forEach(el => el.remove());
}

function handleDragOver(e) {
  e.preventDefault();
  const column = e.target.closest('.column');
  if (!column || !draggedCard) return;
  
  const cardsContainer = column.querySelector('.cards-container');
  const afterElement = getDragAfterElement(cardsContainer, e.clientY);
  
  // Remove existing indicators
  column.querySelectorAll('.drop-indicator').forEach(el => el.remove());
  
  // Add indicator
  if (afterElement) {
    const indicator = document.createElement('div');
    indicator.className = 'drop-indicator';
    indicator.style.borderTop = '3px solid #6366f1';
    indicator.style.margin = '4px 0';
    cardsContainer.insertBefore(indicator, afterElement);
  } else {
    const indicator = document.createElement('div');
    indicator.className = 'drop-indicator';
    indicator.style.borderTop = '3px solid #6366f1';
    indicator.style.margin = '4px 0';
    cardsContainer.appendChild(indicator);
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
  const column = e.target.closest('.column');
  if (!column || !draggedCard) return;
  
  const cardsContainer = column.querySelector('.cards-container');
  const afterElement = getDragAfterElement(cardsContainer, e.clientY);
  
  // Optimistic update in DOM
  const draggedColumnId = draggedCard.dataset.columnId;
  const draggedCardId = draggedCard.dataset.cardId;
  const draggedPosition = parseFloat(draggedCard.dataset.position);
  
  // Remove from source
  const sourceCardsContainer = dragSourceColumn.querySelector('.cards-container');
  
  // Optimistic move - insert at new position
  if (afterElement) {
    sourceCardsContainer.insertBefore(draggedCard, afterElement.nextSibling);
  } else {
    sourceCardsContainer.appendChild(draggedCard);
  }
  
  // Calculate new position
  const newAfterId = afterElement?.dataset.cardId;
  const newBeforeId = afterElement?.nextSibling?.dataset.cardId;
  
  // Send move request
  try {
    const response = await fetch(`/api/cards/${draggedCardId}/move`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        columnId: column.dataset.columnId,
        beforeId: newBeforeId,
        afterId: newAfterId
      })
    });
    
    if (!response.ok) {
      throw new Error('Move failed');
    }
    
    const card = await response.json();
    
    // Update optimistic state with server response
    optimisticUpdates.set(card.id, card);
    
    // Re-render column to ensure canonical order
    renderColumnCards(column);
    
  } catch (error) {
    console.error('Error moving card:', error);
    // Revert DOM change
    cardsContainer.appendChild(draggedCard);
    renderColumnCards(column);
  }
}

function handleAddCardClick(e) {
  if (e.target.classList.contains('add-card-button')) {
    const columnId = e.target.dataset.columnId;
    const input = document.querySelector(`.add-card-input[data-column-id="${columnId}"]`);
    if (input) {
      input.focus();
      input.select();
    }
  }
}

async function handleAddCardSubmit(e) {
  e.preventDefault();
  if (e.target.classList.contains('add-card-button')) return;
  
  const columnId = e.target.closest('.column')?.dataset.columnId;
  const input = e.target;
  
  if (!columnId || !input.value.trim()) return;
  
  try {
    const response = await fetch('/api/cards', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        columnId,
        text: input.value.trim()
      })
    });
    
    if (!response.ok) {
      throw new Error('Failed to create card');
    }
    
    const card = await response.json();
    
    // Optimistic update
    const columnEl = document.querySelector(`.column[data-column-id="${columnId}"]`);
    const cardsContainer = columnEl.querySelector('.cards-container');
    
    const cardEl = createCardElement(card);
    cardsContainer.appendChild(cardEl);
    
    cardIdMap.set(card.id, cardEl);
    optimisticUpdates.set(card.id, card);
    
    // Re-render column to ensure correct position
    renderColumnCards(columnEl);
    
    // Clear input
    input.value = '';
  } catch (error) {
    console.error('Error adding card:', error);
  }
}

// Start the app
init();

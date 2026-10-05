import './app.css';

// Global state
let boardState = [];
let eventSource = null;

// DOM Elements
const root = document.getElementById('root');

// Initialize the app
async function init() {
  const board = await fetchBoard();
  boardState = board;
  render();
  setupSSE();
}

// Fetch board state from API
async function fetchBoard() {
  const response = await fetch('/api/board');
  if (!response.ok) {
    throw new Error('Failed to fetch board');
  }
  return response.json();
}

// Setup SSE connection
function setupSSE() {
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource('/api/stream');

  eventSource.addEventListener('message', (event) => {
    try {
      const data = JSON.parse(event.data);
      handleServerEvent(data);
    } catch (error) {
      console.error('Error parsing SSE message:', error);
    }
  });

  eventSource.addEventListener('error', (error) => {
    console.error('SSE error:', error);
  });
}

// Handle server-sent events
function handleServerEvent(event) {
  if (event.type === 'create') {
    // Find the column and add the card
    const column = boardState.find(col => col.id === event.card.column_id);
    if (column) {
      column.cards.push(event.card);
      // Sort by position
      column.cards.sort((a, b) => a.position - b.position);
      render();
    }
  } else if (event.type === 'move') {
    // Remove card from old position
    boardState.forEach(column => {
      const index = column.cards.findIndex(card => card.id === event.card.id);
      if (index !== -1) {
        column.cards.splice(index, 1);
      }
    });

    // Add card to new column
    const column = boardState.find(col => col.id === event.card.column_id);
    if (column) {
      column.cards.push(event.card);
      column.cards.sort((a, b) => a.position - b.position);
      render();
    }
  } else if (event.type === 'normalize') {
    // Handle position normalization
    const column = boardState.find(col => col.id === event.columnId);
    if (column) {
      column.cards = event.cards;
      render();
    }
  }
}

// Create a card
async function createCard(columnId, text) {
  try {
    const response = await fetch('/api/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columnId, text }),
    });

    if (!response.ok) {
      throw new Error('Failed to create card');
    }

    const card = await response.json();
    const column = boardState.find(col => col.id === columnId);
    if (column) {
      column.cards.push(card);
      column.cards.sort((a, b) => a.position - b.position);
      render();
    }
  } catch (error) {
    console.error('Error creating card:', error);
  }
}

// Move a card
async function moveCard(cardId, columnId, beforeId, afterId) {
  try {
    const response = await fetch(`/api/cards/${cardId}/move`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columnId, beforeId, afterId }),
    });

    if (!response.ok) {
      throw new Error('Failed to move card');
    }

    const card = await response.json();
    // Remove card from old position
    boardState.forEach(column => {
      const index = column.cards.findIndex(c => c.id === cardId);
      if (index !== -1) {
        column.cards.splice(index, 1);
      }
    });

    // Add card to new column
    const column = boardState.find(col => col.id === card.column_id);
    if (column) {
      column.cards.push(card);
      column.cards.sort((a, b) => a.position - b.position);
      render();
    }
  } catch (error) {
    console.error('Error moving card:', error);
  }
}

// Render the board
function render() {
  root.innerHTML = `
    <div class="board">
      ${boardState.map(column => `
        <div class="column" data-column-id="${column.id}">
          <div class="column-header">
            <h2>${column.title}</h2>
            <span class="card-count">${column.cards.length}</span>
          </div>
          <div class="cards-container">
            ${column.cards.map(card => `
              <div class="card" draggable="true" data-card-id="${card.id}" data-card-position="${card.position}">
                <div class="card-text">${escapeHtml(card.text)}</div>
              </div>
            `).join('')}
          </div>
          <div class="card-input-container">
            <input type="text" class="card-input" placeholder="Add a card..." />
            <button class="add-card-btn">Add</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  // Setup drag-and-drop
  setupDragAndDrop();
  // Setup card creation
  setupCardCreation();
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Setup drag-and-drop
function setupDragAndDrop() {
  let draggedCard = null;
  let sourceColumnId = null;

  document.querySelectorAll('.card').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      draggedCard = card;
      sourceColumnId = card.closest('.column').dataset.columnId;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    card.addEventListener('dragend', () => {
      draggedCard = null;
      sourceColumnId = null;
      document.querySelectorAll('.card').forEach(c => c.classList.remove('dragging'));
    });

    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      const targetCard = e.target.closest('.card');
      if (targetCard && targetCard !== draggedCard) {
        // Calculate position based on where we are in the column
        const cards = Array.from(document.querySelectorAll(`.cards-container[data-column-id="${sourceColumnId}"] .card`));
        const draggedIndex = cards.indexOf(draggedCard);
        const targetIndex = cards.indexOf(targetCard);

        if (draggedIndex < targetIndex) {
          targetCard.style.transform = 'translateY(-10px)';
        } else {
          targetCard.style.transform = 'translateY(10px)';
        }
      }
    });

    card.addEventListener('dragleave', (e) => {
      e.target.style.transform = '';
    });

    card.addEventListener('drop', async (e) => {
      e.preventDefault();

      const targetCard = e.target.closest('.card');
      if (!draggedCard || !targetCard) return;

      const targetColumn = targetCard.closest('.column');
      const targetColumnId = targetColumn.dataset.columnId;
      const cardId = draggedCard.dataset.cardId;

      // Get position information
      const cards = Array.from(document.querySelectorAll(`.cards-container[data-column-id="${targetColumnId}"] .card`));
      const targetIndex = cards.indexOf(targetCard);

      let beforeId = null;
      let afterId = null;

      if (targetIndex === 0) {
        beforeId = null;
        afterId = cards[1]?.dataset.cardId || null;
      } else if (targetIndex === cards.length - 1) {
        beforeId = cards[cards.length - 2].dataset.cardId;
        afterId = null;
      } else {
        beforeId = cards[targetIndex - 1].dataset.cardId;
        afterId = cards[targetIndex + 1].dataset.cardId;
      }

      // Optimistic update
      const column = boardState.find(col => col.id === targetColumnId);
      if (column) {
        const cardIndex = column.cards.findIndex(c => c.id === cardId);
        if (cardIndex !== -1) {
          const card = column.cards[cardIndex];
          column.cards.splice(cardIndex, 1);
          column.cards.push(card);
          column.cards.sort((a, b) => a.position - b.position);
          render();
        }
      }

      // Send move request
      await moveCard(cardId, targetColumnId, beforeId, afterId);
    });
  });
}

// Setup card creation
function setupCardCreation() {
  document.querySelectorAll('.card-input-container').forEach(container => {
    const column = container.closest('.column');
    const columnId = column.dataset.columnId;
    const input = container.querySelector('.card-input');
    const button = container.querySelector('.add-card-btn');

    const addCard = () => {
      const text = input.value.trim();
      if (text) {
        createCard(columnId, text);
        input.value = '';
      }
    };

    button.addEventListener('click', addCard);
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        addCard();
      }
    });
  });
}

// Initialize the app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

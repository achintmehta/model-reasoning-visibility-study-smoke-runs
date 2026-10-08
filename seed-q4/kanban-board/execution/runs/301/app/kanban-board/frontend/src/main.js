import '../src/style.css';

// Get DOM elements
const app = document.getElementById('app');

// State
let boardState = { columns: [] };
let draggedCard = null;
let originalCardPosition = null;

// Initialize the app
async function init() {
  // Fetch initial board state
  await fetchBoardState();
  
  // Render the board
  renderBoard();
  
  // Connect to SSE stream
  connectToSSE();
}

// Fetch board state from API
async function fetchBoardState() {
  try {
    const response = await fetch('/api/board');
    const data = await response.json();
    boardState = data;
  } catch (error) {
    console.error('Error fetching board state:', error);
  }
}

// Render the Kanban board
function renderBoard() {
  app.innerHTML = `
    <h1>Kanban Board</h1>
    <div class="kanban-board" id="kanban-board">
      ${boardState.columns.map(column => `
        <div class="column" data-column-id="${column.id}">
          <div class="column-header">${column.title}</div>
          <div class="cards" data-cards-container="${column.id}">
            ${column.cards.map(card => `
              <div class="card-container" data-card-id="${card.id}" draggable="true">
                <div class="card-text">${card.text}</div>
              </div>
            `).join('')}
          </div>
          <input type="text" class="add-card-input" placeholder="Add a new card..." data-column-id="${column.id}">
          <button class="add-card-btn" data-column-id="${column.id}">Add Card</button>
        </div>
      `).join('')}
    </div>
  `;

  // Set up event listeners
  setupEventListeners();
}

// Set up event listeners for drag and drop, card creation, etc.
function setupEventListeners() {
  // Drag and drop events
  const cardContainers = document.querySelectorAll('.card-container');
  cardContainers.forEach(card => {
    card.addEventListener('dragstart', handleDragStart);
    card.addEventListener('dragend', handleDragEnd);
  });

  const columns = document.querySelectorAll('.column');
  columns.forEach(column => {
    const cardsContainer = column.querySelector('[data-cards-container]');
    cardsContainer.addEventListener('dragover', handleDragOver);
    cardsContainer.addEventListener('dragenter', handleDragEnter);
    cardsContainer.addEventListener('dragleave', handleDragLeave);
    cardsContainer.addEventListener('drop', handleDrop);
  });

  // Add card events
  const addCardButtons = document.querySelectorAll('.add-card-btn');
  addCardButtons.forEach(button => {
    button.addEventListener('click', handleAddCard);
  });

  const addCardInputs = document.querySelectorAll('.add-card-input');
  addCardInputs.forEach(input => {
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        handleAddCard(e);
      }
    });
  });
}

// Drag and Drop Handlers
function handleDragStart(e) {
  draggedCard = this;
  originalCardPosition = {
    columnId: parseInt(this.closest('.column').dataset.columnId),
    index: Array.from(this.parentNode.children).indexOf(this)
  };
  
  // Add dragging class
  this.classList.add('dragging');
  
  // Set data transfer
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/html', this.innerHTML);
}

function handleDragEnd() {
  draggedCard = null;
  originalCardPosition = null;
  
  // Remove dragging class from all cards
  document.querySelectorAll('.card-container').forEach(card => {
    card.classList.remove('dragging');
  });
  
  // Remove drag-over class from all columns
  document.querySelectorAll('.column').forEach(column => {
    column.classList.remove('drag-over');
  });
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  return false;
}

function handleDragEnter(e) {
  this.closest('.column').classList.add('drag-over');
}

function handleDragLeave(e) {
  if (!e.target.closest('.card-container')) {
    this.closest('.column').classList.remove('drag-over');
  }
}

function handleDrop(e) {
  e.preventDefault();
  
  // Remove drag-over class from all columns
  document.querySelectorAll('.column').forEach(column => {
    column.classList.remove('drag-over');
  });
  
  const targetColumn = this.closest('.column');
  const targetCardContainer = document.elementFromPoint(
    e.clientX,
    e.clientY
  ).closest('.card-container');
  
  const targetColumnId = parseInt(targetColumn.dataset.columnId);
  const targetCardId = targetCardContainer ? parseInt(targetCardContainer.dataset.cardId) : null;
  
  // Optimistically update the UI
  optimisticUpdate(targetColumnId, targetCardId);
  
  // Send move request to server
  moveCardToServer(
    parseInt(draggedCard.dataset.cardId),
    targetColumnId,
    targetCardId
  );
}

// Optimistically update the UI before getting server confirmation
function optimisticUpdate(targetColumnId, targetCardId) {
  const cardId = parseInt(draggedCard.dataset.cardId);
  
  // Find the card in the state
  const card = boardState.columns
    .flatMap(column => column.cards)
    .find(c => c.id === cardId);
  
  if (!card) return;
  
  // Remove card from original column
  const originalColumn = boardState.columns.find(c => c.id === originalCardPosition.columnId);
  if (originalColumn) {
    originalColumn.cards = originalColumn.cards.filter(c => c.id !== cardId);
  }
  
  // Add card to target column
  const targetColumn = boardState.columns.find(c => c.id === targetColumnId);
  if (targetColumn) {
    if (targetCardId) {
      // Insert before the target card
      const targetIndex = targetColumn.cards.findIndex(c => c.id === targetCardId);
      targetColumn.cards.splice(targetIndex, 0, card);
    } else {
      // Append to the end
      targetColumn.cards.push(card);
    }
  }
  
  // Update card's column_id in state
  card.column_id = targetColumnId;
  
  // Re-render the board
  renderBoard();
}

// Send move request to server
async function moveCardToServer(cardId, targetColumnId, targetCardId) {
  try {
    const response = await fetch(`/api/cards/${cardId}/move`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        columnId: targetColumnId,
        beforeId: targetCardId // Using beforeId for simplicity
      }),
    });
    
    const updatedCard = await response.json();
    
    // Server has confirmed the move, so we don't need to do anything
    // as the SSE will update our state and re-render
  } catch (error) {
    console.error('Error moving card:', error);
    
    // If there was an error, we should revert the optimistic update
    fetchBoardState().then(renderBoard);
  }
}

// Handle adding a new card
async function handleAddCard(e) {
  const input = e.target.previousElementSibling;
  const text = input.value.trim();
  const columnId = parseInt(input.dataset.columnId || e.target.dataset.columnId);
  
  if (!text) return;
  
  // Optimistically add the card to the UI
  const targetColumn = boardState.columns.find(c => c.id === columnId);
  if (targetColumn) {
    const newCard = {
      id: Date.now(), // Temporary ID for optimistic UI
      text: text,
      column_id: columnId,
      position: targetColumn.cards.length
    };
    
    targetColumn.cards.push(newCard);
    renderBoard();
    
    // Clear the input
    input.value = '';
    
    // Send create request to server
    try {
      const response = await fetch('/api/cards', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          columnId: columnId,
          text: text
        }),
      });
      
      const createdCard = await response.json();
      
      // Server has confirmed the creation, so we don't need to do anything
      // as the SSE will update our state and re-render
    } catch (error) {
      console.error('Error creating card:', error);
      
      // If there was an error, we should revert the optimistic update
      fetchBoardState().then(renderBoard);
    }
  }
}

// Connect to SSE stream
function connectToSSE() {
  const eventSource = new EventSource('/api/stream');
  
  eventSource.onmessage = (e) => {
    console.log('Message from SSE:', e.data);
  };
  
  eventSource.addEventListener('initialBoard', (e) => {
    boardState = JSON.parse(e.data);
    renderBoard();
  });
  
  eventSource.addEventListener('cardCreated', (e) => {
    const card = JSON.parse(e.data);
    updateBoardStateWithCard(card);
  });
  
  eventSource.addEventListener('cardMoved', (e) => {
    const card = JSON.parse(e.data);
    updateBoardStateWithCard(card);
  });
  
  eventSource.onerror = (e) => {
    console.error('SSE Error:', e);
    if (e.eventPhase === EventSource.CLOSED) {
      console.log('SSE connection closed');
    } else {
      eventSource.close();
      setTimeout(connectToSSE, 3000); // Reconnect after 3 seconds
    }
  };
}

// Update the board state with a card (used by SSE events)
function updateBoardStateWithCard(card) {
  // Remove card from its current column (if it exists in state)
  const existingColumn = boardState.columns.find(c => 
    c.id === card.column_id && c.cards.some(card => card.id === card.id)
  );
  
  if (existingColumn) {
    existingColumn.cards = existingColumn.cards.filter(c => c.id !== card.id);
  }
  
  // Add card to its new column
  const targetColumn = boardState.columns.find(c => c.id === card.column_id);
  if (targetColumn) {
    // Find the correct position to insert the card
    const insertIndex = targetColumn.cards.findIndex(c => c.position > card.position);
    if (insertIndex === -1) {
      targetColumn.cards.push(card);
    } else {
      targetColumn.cards.splice(insertIndex, 0, card);
    }
  }
  
  // Re-render the board
  renderBoard();
}

// Start the app
init();
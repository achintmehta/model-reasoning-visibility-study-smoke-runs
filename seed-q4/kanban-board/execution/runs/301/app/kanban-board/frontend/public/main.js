let boardData = null;
let draggedCard = null;
let dragStartPosition = null;
let isDragging = false;

// DOM Elements
const boardElement = document.getElementById('board');
let eventSource = null;

// Initialize the board
async function initBoard() {
  try {
    const response = await fetch('/api/board');
    const data = await response.json();
    boardData = data;
    renderBoard();
    setupSSE();
  } catch (error) {
    console.error('Error fetching board data:', error);
  }
}

// Render the board
function renderBoard() {
  boardElement.innerHTML = '';
  
  boardData.columns.forEach(column => {
    const columnElement = document.createElement('div');
    columnElement.className = 'column';
    columnElement.dataset.columnId = column.id;
    
    const columnTitle = document.createElement('h2');
    columnTitle.textContent = column.title;
    
    const cardList = document.createElement('div');
    cardList.className = 'card-list';
    cardList.dataset.columnId = column.id;
    
    // Add card creation input
    const addCardInput = document.createElement('div');
    addCardInput.className = 'add-card';
    
    const addCardText = document.createElement('input');
    addCardText.type = 'text';
    addCardText.placeholder = 'Add a new card...';
    addCardText.addEventListener('keypress', async (e) => {
      if (e.key === 'Enter' && addCardText.value.trim()) {
        await createCard(column.id, addCardText.value.trim());
        addCardText.value = '';
      }
    });
    
    const addCardButton = document.createElement('button');
    addCardButton.textContent = 'Add Card';
    addCardButton.addEventListener('click', async () => {
      if (addCardText.value.trim()) {
        await createCard(column.id, addCardText.value.trim());
        addCardText.value = '';
      }
    });
    
    addCardInput.appendChild(addCardText);
    addCardInput.appendChild(addCardButton);
    
    // Add existing cards
    column.cards.forEach(card => {
      const cardElement = createCardElement(card);
      cardList.appendChild(cardElement);
    });
    
    columnElement.appendChild(columnTitle);
    columnElement.appendChild(cardList);
    columnElement.appendChild(addCardInput);
    
    boardElement.appendChild(columnElement);
    
    // Set up drag and drop event listeners for the card list
    setupDragAndDrop(cardList);
  });
}

// Create a card element
function createCardElement(card) {
  const cardElement = document.createElement('div');
  cardElement.className = 'card';
  cardElement.dataset.cardId = card.id;
  cardElement.draggable = true;
  cardElement.textContent = card.text;
  
  // Set up drag events
  cardElement.addEventListener('dragstart', handleDragStart);
  cardElement.addEventListener('dragend', handleDragEnd);
  
  return cardElement;
}

// Set up drag and drop for a card list
function setupDragAndDrop(cardList) {
  cardList.addEventListener('dragover', handleDragOver);
  cardList.addEventListener('dragenter', handleDragEnter);
  cardList.addEventListener('dragleave', handleDragLeave);
  cardList.addEventListener('drop', handleDrop);
}

// Drag event handlers
function handleDragStart(e) {
  draggedCard = this;
  dragStartPosition = {
    columnId: this.closest('.column').dataset.columnId,
    index: Array.from(this.parentElement.children).indexOf(this)
  };
  
  // Add dragging class for visual feedback
  this.classList.add('dragging');
  
  // Set drag data
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', this.dataset.cardId);
}

function handleDragEnd() {
  if (draggedCard) {
    draggedCard.classList.remove('dragging');
    draggedCard = null;
    dragStartPosition = null;
    isDragging = false;
  }
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  return false;
}

function handleDragEnter(e) {
  this.classList.add('over');
  isDragging = true;
}

function handleDragLeave() {
  this.classList.remove('over');
}

function handleDrop(e) {
  e.preventDefault();
  this.classList.remove('over');
  
  if (!draggedCard || !isDragging) return;
  
  const targetColumnId = this.dataset.columnId;
  const targetColumn = boardData.columns.find(c => c.id === targetColumnId);
  
  if (!targetColumn) return;
  
  // Find drop position
  const dropTarget = document.elementFromPoint(e.clientX, e.clientY);
  let beforeId = null;
  let afterId = null;
  
  // If dropping on a specific card
  if (dropTarget.closest('.card')) {
    const cardElement = dropTarget.closest('.card');
    const cardId = cardElement.dataset.cardId;
    const card = targetColumn.cards.find(c => c.id === cardId);
    
    if (card) {
      // Determine if dropping before or after the target card
      const rect = cardElement.getBoundingClientRect();
      const mouseY = e.clientY - rect.top;
      const midpoint = rect.height / 2;
      
      if (mouseY < midpoint) {
        // Drop before the target card
        beforeId = cardId;
      } else {
        // Drop after the target card
        afterId = cardId;
      }
    }
  } else if (this.children.length === 0) {
    // Dropping on an empty column
    afterId = null;
    beforeId = null;
  } else {
    // Dropping at the end of the column
    const lastCard = this.lastChild;
    afterId = lastCard.dataset.cardId;
  }
  
  // Optimistically update the UI
  optimisticUpdate(draggedCard, targetColumnId, beforeId, afterId);
  
  // Send move request to server
  moveCard(draggedCard.dataset.cardId, targetColumnId, beforeId, afterId)
    .catch(error => {
      console.error('Error moving card:', error);
      // Revert optimistic update on error
      initBoard();
    });
}

// Optimistically update the UI before receiving server response
function optimisticUpdate(cardElement, targetColumnId, beforeId, afterId) {
  const cardId = cardElement.dataset.cardId;
  const card = boardData.columns.flatMap(c => c.cards).find(c => c.id === cardId);
  
  if (!card) return;
  
  // Remove card from source column
  const sourceColumn = boardData.columns.find(c => 
    c.cards.some(card => card.id === cardId)
  );
  
  if (sourceColumn) {
    sourceColumn.cards = sourceColumn.cards.filter(c => c.id !== cardId);
  }
  
  // Add card to target column
  const targetColumn = boardData.columns.find(c => c.id === targetColumnId);
  
  if (targetColumn) {
    // Determine position in target column
    if (beforeId) {
      const beforeCard = targetColumn.cards.find(c => c.id === beforeId);
      const index = targetColumn.cards.indexOf(beforeCard);
      targetColumn.cards.splice(index, 0, card);
    } else if (afterId) {
      const afterCard = targetColumn.cards.find(c => c.id === afterId);
      const index = targetColumn.cards.indexOf(afterCard);
      targetColumn.cards.splice(index + 1, 0, card);
    } else {
      targetColumn.cards.push(card);
    }
  }
  
  // Update the DOM
  renderBoard();
}

// Create a new card
async function createCard(columnId, text) {
  try {
    // Optimistically add the card to the UI
    const column = boardData.columns.find(c => c.id === columnId);
    if (column) {
      const tempId = `temp-${Date.now()}`;
      const newCard = {
        id: tempId,
        text: text,
        position: column.cards.length + 1
      };
      column.cards.push(newCard);
      renderBoard();
      
      // Wait for a short time to ensure the UI updates before the server request
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Send create request to server
      const response = await fetch('/api/cards', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ columnId, text })
      });
      
      const data = await response.json();
      
      // The SSE will update the UI with the canonical state
      return data;
    }
  } catch (error) {
    console.error('Error creating card:', error);
    // Revert optimistic update on error
    initBoard();
    throw error;
  }
}

// Move a card
async function moveCard(cardId, columnId, beforeId, afterId) {
  try {
    const response = await fetch(`/api/cards/${cardId}/move`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ columnId, beforeId, afterId })
    });
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error moving card:', error);
    throw error;
  }
}

// Set up SSE connection
function setupSSE() {
  // Close any existing SSE connection
  if (eventSource) {
    eventSource.close();
  }
  
  // Create new SSE connection
  eventSource = new EventSource('/api/stream');
  
  // Handle connection open
  eventSource.onopen = function() {
    console.log('SSE connection opened');
  };
  
  // Handle general messages
  eventSource.onmessage = function(event) {
    console.log('Received SSE message:', event.data);
  };
  
  // Handle card created events
  eventSource.addEventListener('card-created', function(event) {
    try {
      const data = JSON.parse(event.data);
      const columnId = data.columnId;
      const column = data.column;
      
      // Update the board data
      const columnIndex = boardData.columns.findIndex(c => c.id === columnId);
      if (columnIndex !== -1) {
        boardData.columns[columnIndex] = column;
      }
      
      renderBoard();
    } catch (error) {
      console.error('Error processing card-created event:', error);
    }
  });
  
  // Handle card moved events
  eventSource.addEventListener('card-moved', function(event) {
    try {
      const data = JSON.parse(event.data);
      
      // Update source column if it exists
      if (data.sourceColumn) {
        const sourceIndex = boardData.columns.findIndex(c => c.id === data.sourceColumn.id);
        if (sourceIndex !== -1) {
          boardData.columns[sourceIndex] = data.sourceColumn;
        }
      }
      
      // Update target column
      if (data.targetColumn) {
        const targetIndex = boardData.columns.findIndex(c => c.id === data.targetColumn.id);
        if (targetIndex !== -1) {
          boardData.columns[targetIndex] = data.targetColumn;
        }
      }
      
      renderBoard();
    } catch (error) {
      console.error('Error processing card-moved event:', error);
    }
  });
  
  // Handle column update events
  eventSource.addEventListener('column-update', function(event) {
    try {
      const data = JSON.parse(event.data);
      const column = data.column;
      
      // Update the column in board data
      const columnIndex = boardData.columns.findIndex(c => c.id === column.id);
      if (columnIndex !== -1) {
        boardData.columns[columnIndex] = column;
      }
      
      renderBoard();
    } catch (error) {
      console.error('Error processing column-update event:', error);
    }
  });
  
  // Handle connection errors
  eventSource.onerror = function(error) {
    console.error('SSE error:', error);
    
    // Try to reconnect after a delay
    setTimeout(() => {
      setupSSE();
    }, 3000);
  };
}

// Initialize the board when the page loads
document.addEventListener('DOMContentLoaded', () => {
  initBoard();
});
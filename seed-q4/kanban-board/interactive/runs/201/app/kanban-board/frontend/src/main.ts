import './style.css';

// Types
interface Column {
  id: string;
  title: string;
  position: number;
  cards: Card[];
}

interface Card {
  id: string;
  column_id: string;
  text: string;
  position: number;
  created_at: string;
}

interface CardMoveEvent {
  card: Card;
  oldColumnId: string;
}

// DOM Elements
const app = document.getElementById('app') as HTMLElement;
let columnsById: Record<string, HTMLElement> = {};
let cardsById: Record<string, HTMLElement> = {};

// State
let boardState: Column[] = [];

// Initialize the board
async function initBoard() {
  try {
    // Fetch initial board state - use direct URL to bypass proxy issues
    const response = await fetch('http://localhost:3000/api/board');
    boardState = await response.json();
    
    // Render the board
    renderBoard();
    
    // Connect to SSE stream
    connectToSSE();
  } catch (error) {
    console.error('Failed to initialize board:', error);
  }
}

// Render the board
function renderBoard() {
  // Clear existing content
  app.innerHTML = `
    <h1>Kanban Board</h1>
    <div class="board" id="board"></div>
  `;
  
  const boardEl = document.getElementById('board') as HTMLElement;
  columnsById = {};
  cardsById = {};
  
  // Sort columns by position
  const sortedColumns = [...boardState].sort((a, b) => a.position - b.position);
  
  // Render each column
  sortedColumns.forEach(column => {
    const columnEl = document.createElement('div');
    columnEl.className = 'column';
    columnEl.dataset.columnId = column.id;
    
    // Create column header
    const headerEl = document.createElement('div');
    headerEl.className = 'column-header';
    
    const titleEl = document.createElement('div');
    titleEl.className = 'column-title';
    titleEl.textContent = column.title;
    
    const addBtnEl = document.createElement('button');
    addBtnEl.className = 'add-card-btn';
    addBtnEl.textContent = 'Add Card';
    addBtnEl.addEventListener('click', () => showAddCardForm(column.id));
    
    headerEl.appendChild(titleEl);
    headerEl.appendChild(addBtnEl);
    columnEl.appendChild(headerEl);
    
    // Create card list
    const cardListEl = document.createElement('div');
    cardListEl.className = 'card-list';
    cardListEl.dataset.columnId = column.id;
    
    // Sort cards by position
    const sortedCards = [...column.cards].sort((a, b) => a.position - b.position);
    
    // Render each card
    sortedCards.forEach(card => {
      const cardEl = createCardElement(card);
      cardListEl.appendChild(cardEl);
      cardsById[card.id] = cardEl;
    });
    
    columnEl.appendChild(cardListEl);
    boardEl.appendChild(columnEl);
    columnsById[column.id] = columnEl;
  });
  
  // Set up drag-and-drop events
  setupDragAndDrop();
}

// Create a card element
function createCardElement(card: Card): HTMLElement {
  const cardEl = document.createElement('div');
  cardEl.className = 'card';
  cardEl.dataset.cardId = card.id;
  cardEl.draggable = true;
  cardEl.textContent = card.text;
  
  return cardEl;
}

// Show add card form
function showAddCardForm(columnId: string) {
  const columnEl = columnsById[columnId];
  const cardListEl = columnEl.querySelector('.card-list') as HTMLElement;
  
  // Check if form already exists
  let formEl = cardListEl.querySelector('.add-card-form');
  
  if (!formEl) {
    formEl = document.createElement('div');
    formEl.className = 'add-card-form';
    
    const inputEl = document.createElement('input');
    inputEl.className = 'add-card-input';
    inputEl.placeholder = 'Enter card title...';
    
    const submitBtnEl = document.createElement('button');
    submitBtnEl.className = 'add-card-btn';
    submitBtnEl.textContent = 'Add Card';
    
    formEl.appendChild(inputEl);
    formEl.appendChild(submitBtnEl);
    
    // Add submit event listener
    submitBtnEl.addEventListener('click', async () => {
      const text = inputEl.value.trim();
      if (text) {
        try {
          // Optimistically add the card to the UI
          const newCard: Card = {
            id: `temp-${Date.now()}`,
            column_id: columnId,
            text,
            position: Date.now(), // Temporary position
            created_at: new Date().toISOString()
          };
          
          const cardEl = createCardElement(newCard);
          cardListEl.appendChild(cardEl);
          cardsById[newCard.id] = cardEl;
          
          // Clear input and hide form
          inputEl.value = '';
          formEl.remove();
          
          // Send request to server
          const response = await fetch('http://localhost:3000/api/cards', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ columnId, text })
          });
          
          const serverCard = await response.json();
          
          // Replace temporary card with server card
          const tempCardEl = document.querySelector(`[data-card-id="temp-${Date.now()}"]`) as HTMLElement;
          if (tempCardEl) {
            tempCardEl.remove();
          }
          
          // The SSE event will update the board with the canonical state
        } catch (error) {
          console.error('Failed to create card:', error);
          // In a real app, we would show an error message to the user
        }
      }
    });
    
    // Add enter key support
    inputEl.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        submitBtnEl.click();
      }
    });
    
    cardListEl.appendChild(formEl);
  }
}

// Set up drag-and-drop events
function setupDragAndDrop() {
  const boardEl = document.getElementById('board') as HTMLElement;
  let draggedCard: HTMLElement | null = null;
  let sourceColumnId: string | null = null;
  let sourceCardIndex: number | null = null;
  let isDraggingOverColumn: boolean = false;
  let isDraggingOverCard: boolean = false;
  let overCardId: string | null = null;
  
  // Add event listeners to all cards
  document.querySelectorAll('.card').forEach(card => {
    card.addEventListener('dragstart', handleDragStart);
    card.addEventListener('dragend', handleDragEnd);
  });
  
  // Add event listeners to all columns
  document.querySelectorAll('.column').forEach(column => {
    column.addEventListener('dragover', handleDragOver);
    column.addEventListener('dragenter', handleDragEnter);
    column.addEventListener('dragleave', handleDragLeave);
    column.addEventListener('drop', handleDrop);
  });
  
  function handleDragStart(e: DragEvent) {
    const cardEl = e.currentTarget as HTMLElement;
    draggedCard = cardEl;
    sourceColumnId = cardEl.dataset.columnId;
    
    // Store original position for later
    const cardId = cardEl.dataset.cardId;
    if (cardId) {
      const card = boardState.find(c => c.id === sourceColumnId)?.cards.find(c => c.id === cardId);
      if (card) {
        sourceCardIndex = card.position;
      }
    }
    
    // Add dragging class
    cardEl.classList.add('dragging');
    
    // Set data transfer
    e.dataTransfer?.setData('text/plain', cardEl.dataset.cardId || '');
  }
  
  function handleDragEnd() {
    if (draggedCard) {
      draggedCard.classList.remove('dragging');
      draggedCard = null;
      sourceColumnId = null;
      sourceCardIndex = null;
      isDraggingOverColumn = false;
      isDraggingOverCard = false;
      overCardId = null;
    }
  }
  
  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    
    // Only allow dropping if we have a dragged card
    if (!draggedCard) return;
    
    const columnEl = e.currentTarget as HTMLElement;
    const columnId = columnEl.dataset.columnId;
    
    // If dragging within the same column and over the same card, do nothing
    if (columnId === sourceColumnId && overCardId === draggedCard.dataset.cardId) {
      return;
    }
    
    // Get card elements in the column
    const cardElements = Array.from(columnEl.querySelectorAll('.card'));
    const mouseY = e.clientY;
    
    // Find which card we're hovering over
    let newOverCardId: string | null = null;
    
    cardElements.forEach(cardEl => {
      const rect = cardEl.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      
      if (mouseY < midpoint) {
        newOverCardId = cardEl.dataset.cardId || null;
        return;
      }
    });
    
    // If we're hovering over a different card, update the overlay
    if (newOverCardId !== overCardId) {
      overCardId = newOverCardId;
      
      // Clear existing overlays
      document.querySelectorAll('.card-overlay').forEach(overlay => {
        overlay.classList.remove('visible');
      });
      
      // Create and show new overlay if needed
      if (overCardId) {
        const cardEl = document.querySelector(`[data-card-id="${overCardId}"]`) as HTMLElement;
        if (cardEl) {
          const overlayEl = document.createElement('div');
          overlayEl.className = 'card-overlay visible';
          cardEl.parentNode?.insertBefore(overlayEl, cardEl);
        }
      }
    }
    
    // Set drop effect
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
  }
  
  function handleDragEnter(e: DragEvent) {
    e.preventDefault();
    
    if (!draggedCard) return;
    
    const columnEl = e.currentTarget as HTMLElement;
    isDraggingOverColumn = true;
    
    // Add a visual indicator for the column
    columnEl.style.border = '2px dashed #0079bf';
  }
  
  function handleDragLeave(e: DragEvent) {
    if (!draggedCard) return;
    
    const columnEl = e.currentTarget as HTMLElement;
    
    // Check if we're actually leaving the column (not just entering a child element)
    const relatedTarget = e.relatedTarget as HTMLElement;
    if (!columnEl.contains(relatedTarget)) {
      isDraggingOverColumn = false;
      columnEl.style.border = '';
      
      // Remove overlay if we're no longer over any column
      if (!isDraggingOverColumn) {
        document.querySelectorAll('.card-overlay').forEach(overlay => {
          overlay.classList.remove('visible');
        });
        overCardId = null;
      }
    }
  }
  
  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    
    if (!draggedCard || !sourceColumnId) return;
    
    const columnEl = e.currentTarget as HTMLElement;
    const targetColumnId = columnEl.dataset.columnId;
    
    if (!targetColumnId) return;
    
    // Remove visual indicators
    columnEl.style.border = '';
    isDraggingOverColumn = false;
    
    // Remove overlay
    document.querySelectorAll('.card-overlay').forEach(overlay => {
      overlay.classList.remove('visible');
    });
    overCardId = null;
    
    // Get the card ID from data transfer
    const cardId = e.dataTransfer?.getData('text/plain');
    if (!cardId) return;
    
    // Find the card in the board state
    let sourceColumn = boardState.find(c => c.id === sourceColumnId);
    if (!sourceColumn) return;
    
    let card = sourceColumn.cards.find(c => c.id === cardId);
    if (!card) return;
    
    // Optimistically update the UI
    const cardEl = draggedCard;
    columnEl.querySelector('.card-list')?.appendChild(cardEl);
    
    // Determine where to place the card in the target column
    let beforeId: string | null = null;
    let afterId: string | null = null;
    
    if (overCardId) {
      // Find the card we're dropping over
      const targetCard = boardState.find(c => c.id === targetColumnId)?.cards.find(c => c.id === overCardId);
      
      if (targetCard) {
        // Drop before the target card
        beforeId = targetCard.id;
        
        // If dropping in the same column, we need to adjust the positions of the cards in between
        if (sourceColumnId === targetColumnId) {
          const cardsInColumn = sourceColumn.cards.filter(c => c.position >= targetCard.position);
          cardsInColumn.forEach(c => {
            c.position += 0.1;
          });
        }
      }
    } else {
      // Drop at the end of the column
      const targetColumn = boardState.find(c => c.id === targetColumnId);
      if (targetColumn) {
        const maxPos = targetColumn.cards.reduce((max, c) => Math.max(max, c.position), -1);
        card.position = maxPos + 1;
      }
    }
    
    // Send move request to server
    try {
      const response = await fetch(`http://localhost:3000/api/cards/${cardId}/move`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          columnId: targetColumnId,
          beforeId,
          afterId
        })
      });
      
      const updatedCard = await response.json();
      
      // The SSE event will update the board with the canonical state
    } catch (error) {
      console.error('Failed to move card:', error);
      // In a real app, we would revert the optimistic update and show an error message
    }
  }
}

// Connect to SSE stream
function connectToSSE() {
  const eventSource = new EventSource('/api/stream');
  
  eventSource.onmessage = (event) => {
    console.log('Received message:', event.data);
  };
  
  eventSource.addEventListener('cardCreated', (event) => {
    const card = JSON.parse(event.data) as Card;
    updateBoardWithEvent(card, 'created');
  });
  
  eventSource.addEventListener('cardMoved', (event) => {
    const moveEvent = JSON.parse(event.data) as CardMoveEvent;
    updateBoardWithEvent(moveEvent.card, 'moved', moveEvent.oldColumnId);
  });
  
  eventSource.addEventListener('positionsRenormalized', (event) => {
    const data = JSON.parse(event.data);
    updateBoardWithEvent(data, 'renormalized');
  });
  
  eventSource.onerror = (error) => {
    console.error('SSE error:', error);
    // In a real app, we would handle reconnection logic
  };
}

// Update the board with an event
function updateBoardWithEvent(data: any, eventType: string, oldColumnId?: string) {
  // In a real app, we would update the board state and re-render
  // For now, we'll just fetch the entire board again to keep it simple
  fetch('http://localhost:3000/api/board')
    .then(response => response.json())
    .then(newBoardState => {
      boardState = newBoardState;
      renderBoard();
    })
    .catch(error => console.error('Failed to update board:', error));
}

// Start the app
initBoard();
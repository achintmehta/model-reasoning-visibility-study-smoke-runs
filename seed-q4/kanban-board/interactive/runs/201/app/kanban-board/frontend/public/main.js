document.addEventListener('DOMContentLoaded', () => {
  const boardElement = document.getElementById('board');
  let boardState = [];
  let draggedCard = null;
  let dragOverColumn = null;
  let dragOverCard = null;
  
  // Fetch initial board state
  fetch('/api/board')
    .then(response => response.json())
    .then(data => {
      boardState = data;
      renderBoard();
      initSSE();
    })
    .catch(error => console.error('Error fetching board state:', error));
  
  // Render the board
  function renderBoard() {
    boardElement.innerHTML = '';
    
    boardState.forEach(column => {
      const columnElement = document.createElement('div');
      columnElement.className = 'column';
      columnElement.dataset.columnId = column.id;
      
      const titleElement = document.createElement('h2');
      titleElement.textContent = column.title;
      
      const addCardInput = document.createElement('input');
      addCardInput.type = 'text';
      addCardInput.placeholder = 'Add a new card...';
      addCardInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && addCardInput.value.trim()) {
          addCard(column.id, addCardInput.value.trim());
          addCardInput.value = '';
        }
      });
      
      const cardsContainer = document.createElement('div');
      cardsContainer.className = 'cards-container';
      
      column.cards.sort((a, b) => a.position - b.position).forEach(card => {
        const cardElement = createCardElement(card);
        cardsContainer.appendChild(cardElement);
      });
      
      columnElement.appendChild(titleElement);
      columnElement.appendChild(addCardInput);
      columnElement.appendChild(cardsContainer);
      boardElement.appendChild(columnElement);
    });
  }
  
  // Create a card element
  function createCardElement(card) {
    const cardElement = document.createElement('div');
    cardElement.className = 'card';
    cardElement.dataset.cardId = card.id;
    cardElement.draggable = true;
    cardElement.textContent = card.text;
    
    // Drag start event
    cardElement.addEventListener('dragstart', (e) => {
      draggedCard = card;
      cardElement.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.id);
    });
    
    // Drag end event
    cardElement.addEventListener('dragend', () => {
      draggedCard = null;
      document.querySelectorAll('.card').forEach(el => {
        el.classList.remove('dragging');
      });
    });
    
    return cardElement;
  }
  
  // Add a new card to a column
  function addCard(columnId, text) {
    // Optimistic UI update
    const newCard = {
      id: `temp-${Date.now()}`,
      column_id: columnId,
      text: text,
      position: 1
    };
    
    // Find the column and add the card
    const column = boardState.find(c => c.id === columnId);
    if (column) {
      // Add to the end of the column
      column.cards.push(newCard);
      renderBoard();
    }
    
    // Send request to server
    fetch('/api/cards', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ columnId: columnId, text: text }),
    })
    .then(response => response.json())
    .then(serverCard => {
      // Replace the temporary card with the server's canonical card
      const column = boardState.find(c => c.id === columnId);
      if (column) {
        const tempCardIndex = column.cards.findIndex(c => c.id.startsWith('temp-'));
        if (tempCardIndex !== -1) {
          column.cards[tempCardIndex] = serverCard;
          renderBoard();
        }
      }
    })
    .catch(error => {
      console.error('Error adding card:', error);
      // Revert optimistic UI update
      const column = boardState.find(c => c.id === columnId);
      if (column) {
        const tempCardIndex = column.cards.findIndex(c => c.id.startsWith('temp-'));
        if (tempCardIndex !== -1) {
          column.cards.splice(tempCardIndex, 1);
          renderBoard();
        }
      }
    });
  }
  
  // Handle dropping a card
  function handleDrop(event) {
    event.preventDefault();
    
    if (!draggedCard) return;
    
    const targetColumnId = event.currentTarget.dataset.columnId;
    const targetCardId = event.target.closest('.card')?.dataset.cardId;
    
    // Determine where to place the card
    let beforeId = null;
    let afterId = null;
    
    if (targetCardId) {
      // Drop between the target card and the next one, or after if dropping on the card itself
      const targetCard = boardState
        .find(c => c.id === targetColumnId)
        .cards.find(c => c.id === targetCardId);
      
      if (event.clientY < event.target.getBoundingClientRect().top + event.target.offsetHeight / 2) {
        // Drop above the target card
        beforeId = targetCardId;
      } else {
        // Drop below the target card
        afterId = targetCardId;
      }
    }
    
    // Optimistic UI update
    const sourceColumn = boardState.find(c => c.id === draggedCard.column_id);
    const targetColumn = boardState.find(c => c.id === targetColumnId);
    
    if (sourceColumn && targetColumn) {
      // Remove from source column
      const sourceIndex = sourceColumn.cards.findIndex(c => c.id === draggedCard.id);
      if (sourceIndex !== -1) {
        sourceColumn.cards.splice(sourceIndex, 1);
      }
      
      // Add to target column
      if (beforeId) {
        const beforeIndex = targetColumn.cards.findIndex(c => c.id === beforeId);
        if (beforeIndex !== -1) {
          targetColumn.cards.splice(beforeIndex, 0, { ...draggedCard, column_id: targetColumnId });
        } else {
          targetColumn.cards.push({ ...draggedCard, column_id: targetColumnId });
        }
      } else if (afterId) {
        const afterIndex = targetColumn.cards.findIndex(c => c.id === afterId);
        if (afterIndex !== -1) {
          targetColumn.cards.splice(afterIndex + 1, 0, { ...draggedCard, column_id: targetColumnId });
        } else {
          targetColumn.cards.push({ ...draggedCard, column_id: targetColumnId });
        }
      } else {
        targetColumn.cards.push({ ...draggedCard, column_id: targetColumnId });
      }
      
      renderBoard();
    }
    
    // Send move request to server
    fetch(`/api/cards/${draggedCard.id}/move`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        columnId: targetColumnId,
        beforeId: beforeId,
        afterId: afterId
      }),
    })
    .then(response => response.json())
    .then(serverCard => {
      // Update the board state with the server's canonical card
      const sourceColumn = boardState.find(c => c.id === draggedCard.column_id);
      const targetColumn = boardState.find(c => c.id === targetColumnId);
      
      if (sourceColumn) {
        const sourceIndex = sourceColumn.cards.findIndex(c => c.id === draggedCard.id);
        if (sourceIndex !== -1) {
          sourceColumn.cards.splice(sourceIndex, 1);
        }
      }
      
      if (targetColumn) {
        const tempIndex = targetColumn.cards.findIndex(c => c.id === draggedCard.id);
        if (tempIndex !== -1) {
          targetColumn.cards[tempIndex] = serverCard;
        } else {
          // If the card wasn't found (might have been removed in another client's update)
          // add it to the end
          targetColumn.cards.push(serverCard);
        }
      }
      
      boardState = boardState.map(col => {
        if (col.id === draggedCard.column_id) {
          return { ...col, cards: col.cards.filter(c => c.id !== draggedCard.id) };
        } else if (col.id === targetColumnId) {
          return { 
            ...col, 
            cards: col.cards.map(c => c.id === draggedCard.id ? serverCard : c)
          };
        }
        return col;
      });
      
      renderBoard();
    })
    .catch(error => {
      console.error('Error moving card:', error);
      // Revert optimistic UI update
      const sourceColumn = boardState.find(c => c.id === draggedCard.column_id);
      const targetColumn = boardState.find(c => c.id === targetColumnId);
      
      if (sourceColumn) {
        sourceColumn.cards.push(draggedCard);
      }
      
      if (targetColumn) {
        const tempIndex = targetColumn.cards.findIndex(c => c.id === draggedCard.id);
        if (tempIndex !== -1) {
          targetColumn.cards.splice(tempIndex, 1);
        }
      }
      
      renderBoard();
    });
  }
  
  // Initialize SSE connection
  function initSSE() {
    const eventSource = new EventSource('/api/stream');
    
    eventSource.onmessage = (event) => {
      console.log('Received message:', event.data);
    };
    
    eventSource.addEventListener('cardCreated', (event) => {
      const card = JSON.parse(event.data);
      const column = boardState.find(c => c.id === card.column_id);
      
      if (column) {
        // Replace any temporary card with the same text (simplified conflict resolution)
        const tempCardIndex = column.cards.findIndex(c => 
          c.id.startsWith('temp-') && c.text === card.text
        );
        
        if (tempCardIndex !== -1) {
          column.cards[tempCardIndex] = card;
        } else {
          // Add the new card to the end of the column
          column.cards.push(card);
        }
        
        renderBoard();
      }
    });
    
    eventSource.addEventListener('cardMoved', (event) => {
      const data = JSON.parse(event.data);
      const card = data.card;
      const columnId = data.columnId;
      
      // Update the board state to match the server's canonical state
      boardState = boardState.map(col => {
        if (col.id === card.column_id) {
          // Card is in this column - update it
          return {
            ...col,
            cards: col.cards.map(c => c.id === card.id ? card : c)
          };
        } else if (col.id === card.column_id) {
          // Card just moved to this column - add it
          return {
            ...col,
            cards: [...col.cards, card]
          };
        } else if (col.id !== card.column_id && col.id !== columnId) {
          // Card was in this column but moved away - remove it
          return {
            ...col,
            cards: col.cards.filter(c => c.id !== card.id)
          };
        }
        return col;
      });
      
      renderBoard();
    });
    
    eventSource.addEventListener('columnRenormalized', (event) => {
      const data = JSON.parse(event.data);
      const columnId = data.columnId;
      const cards = data.cards;
      
      // Update the column with the renormalized cards
      const column = boardState.find(c => c.id === columnId);
      if (column) {
        column.cards = cards;
        renderBoard();
      }
    });
    
    eventSource.onerror = (error) => {
      console.error('SSE error:', error);
      eventSource.close();
      // Try to reconnect after a delay
      setTimeout(initSSE, 3000);
    };
  }
  
  // Set up event listeners for drag-and-drop
  boardElement.addEventListener('dragover', (e) => {
    e.preventDefault();
    const columnElement = e.target.closest('.column');
    
    if (columnElement && columnElement !== dragOverColumn) {
      dragOverColumn = columnElement;
      
      // Clear any existing placeholder
      const existingPlaceholder = columnElement.querySelector('.placeholder');
      if (existingPlaceholder) {
        existingPlaceholder.remove();
      }
      
      // Create a placeholder at the drop position
      const cardElement = e.target.closest('.card');
      if (cardElement) {
        const placeholder = document.createElement('div');
        placeholder.className = 'placeholder';
        
        if (e.clientY < cardElement.getBoundingClientRect().top + cardElement.offsetHeight / 2) {
          // Drop above the card
          columnElement.insertBefore(placeholder, cardElement);
        } else {
          // Drop below the card
          columnElement.insertBefore(placeholder, cardElement.nextSibling);
        }
      } else {
        // Drop at the bottom of the column
        const cardsContainer = columnElement.querySelector('.cards-container');
        cardsContainer.appendChild(document.createElement('div')).className = 'placeholder';
      }
    }
  });
  
  boardElement.addEventListener('drop', (e) => {
    e.preventDefault();
    
    // Remove any placeholder
    const placeholders = document.querySelectorAll('.placeholder');
    placeholders.forEach(p => p.remove());
    
    handleDrop(e);
  });
});
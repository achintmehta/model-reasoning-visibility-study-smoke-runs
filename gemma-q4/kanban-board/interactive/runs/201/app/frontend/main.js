const API_BASE = 'http://localhost:3000/api';

let boardState = [];

async function fetchBoard() {
  const response = await fetch(`${API_BASE}/board`);
  boardState = await response.json();
  renderBoard();
}

function renderBoard() {
  const boardEl = document.getElementById('board');
  boardEl.innerHTML = '';

  boardState.forEach(column => {
    const colEl = document.createElement('div');
    colEl.className = 'column';
    colEl.dataset.id = column.id;

    colEl.innerHTML = `
      <div class="column-header">${column.title}</div>
      <div class="cards-container" data-column-id="${column.id}"></div>
      <div class="add-card-form">
        <input type="text" placeholder="Add card..." class="card-input">
        <button class="add-btn">Add</button>
      </div>
    `;

    const cardsContainer = colEl.querySelector('.cards-container');
    
    // Sort cards by position
    const sortedCards = [...column.cards].sort((a, b) => a.position - b.position);

    sortedCards.forEach(card => {
      const cardEl = createCardElement(card);
      cardsContainer.appendChild(cardEl);
    });

    // Setup add card event
    const input = colEl.querySelector('.card-input');
    const btn = colEl.querySelector('.add-btn');
    
    const addCard = async () => {
      const text = input.value.trim();
      if (!text) return;
      
      // Optimistic add
      const tempId = 'temp-' + Date.now();
      const tempCard = { id: tempId, text, position: 999999, column_id: column.id };
      
      // Add to state and render
      const col = boardState.find(c => c.id === column.id);
      col.cards.push(tempCard);
      renderBoard();
      input.value = '';

      try {
        const response = await fetch(`${API_BASE}/cards`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ columnId: column.id, text })
        });
        const newCard = await response.json();
        
        // Replace temp card with server card
        const index = col.cards.findIndex(c => c.id === tempId);
        if (index !== -1) {
          col.cards[index] = newCard;
        }
        renderBoard();
      } catch (err) {
        console.error('Error adding card:', err);
        // Rollback optimistic add
        const index = col.cards.findIndex(c => c.id === tempId);
        if (index !== -1) col.cards.splice(index, 1);
        renderBoard();
      }
    };

    btn.onclick = addCard;
    input.onkeypress = (e) => { if (e.key === 'Enter') addCard(); };

    boardEl.appendChild(colEl);
  });

  setupDragAndDrop();
}

function createCardElement(card) {
  const el = document.createElement('div');
  el.className = 'card';
  el.draggable = true;
  el.id = `card-${card.id}`;
  el.textContent = card.text;
  el.dataset.id = card.id;
  el.dataset.columnId = card.column_id;

  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', card.id);
    el.classList.add('dragging');
  });

  el.addEventListener('dragend', () => {
    el.classList.remove('dragging');
  });

  return el;
}

function setupDragAndDrop() {
  const containers = document.querySelectorAll('.cards-container');

  containers.forEach(container => {
    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      const draggingEl = document.querySelector('.dragging');
      if (!draggingEl) return;

      const afterElement = getDragAfterElement(container, e.clientY);
      if (afterElement == null) {
        container.appendChild(draggingEl);
      } else {
        container.insertBefore(draggingEl, afterElement);
      }
    });

    container.addEventListener('drop', async (e) => {
      e.preventDefault();
      const cardId = e.dataTransfer.getData('text/plain');
      const columnId = container.dataset.columnId;
      
      const draggingEl = document.getElementById(`card-${cardId}`);
      if (!draggingEl) return;

      const cards = [...container.querySelectorAll('.card')];
      const index = cards.indexOf(draggingEl);
      
      const beforeId = index > 0 ? cards[index - 1].dataset.id : null;
      const afterId = index < cards.length - 1 ? cards[index + 1].dataset.id : null;

      // Optimistic state update
      updateLocalState(cardId, columnId, beforeId, afterId);

      try {
        const response = await fetch(`${API_BASE}/cards/${cardId}/move`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ columnId, beforeId, afterId })
        });
        const updatedCard = await response.json();
        
        // Sync local state with server's authoritative data
        syncCardInState(updatedCard);
        // Re-render to ensure correct order based on server position
        renderBoard();
      } catch (err) {
        console.error('Error moving card:', err);
        fetchBoard(); // Rollback to server state
      }
    });
  });
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

function updateLocalState(cardId, columnId, beforeId, afterId) {
  // Move card between columns in local state
  let cardToMove = null;
  boardState.forEach(col => {
    const index = col.cards.findIndex(c => c.id === cardId);
    if (index !== -1) {
      cardToMove = col.cards.splice(index, 1)[0];
    }
  });

  if (cardToMove) {
    const targetCol = boardState.find(col => col.id === columnId);
    // We don't know the exact position yet, but we can put it in the array
    // based on beforeId/afterId for a rough optimistic render.
    if (!beforeId && !afterId) {
      targetCol.cards.push(cardToMove);
    } else if (beforeId) {
      const index = targetCol.cards.findIndex(c => c.id === beforeId);
      targetCol.cards.splice(index, 0, cardToMove);
    } else if (afterId) {
      const index = targetCol.cards.findIndex(c => c.id === afterId);
      targetCol.cards.splice(index, 0, cardToMove);
    } else {
      targetCol.cards.push(cardToMove);
    }
  }
}

function syncCardInState(updatedCard) {
  // Remove card from all columns
  boardState.forEach(col => {
    col.cards = col.cards.filter(c => c.id !== updatedCard.id);
  });

  // Add to the correct column
  const col = boardState.find(c => c.id === updatedCard.column_id);
  if (col) {
    col.cards.push(updatedCard);
  }
}

function setupSSE() {
  const eventSource = new EventSource(`${API_BASE}/stream`);

  eventSource.addEventListener('cardCreated', (e) => {
    const newCard = JSON.parse(e.data);
    const col = boardState.find(c => c.id === newCard.column_id);
    if (col) {
      if (!col.cards.find(c => c.id === newCard.id)) {
        col.cards.push(newCard);
        renderBoard();
      }
    }
  });

  eventSource.addEventListener('cardMoved', (e) => {
    const updatedCard = JSON.parse(e.data);
    syncCardInState(updatedCard);
    renderBoard();
  });

  eventSource.addEventListener('columnRenormalized', (e) => {
    const { columnId, cards } = JSON.parse(e.data);
    const col = boardState.find(c => c.id === columnId);
    if (col) {
      col.cards = cards;
      renderBoard();
    }
  });

  eventSource.onerror = (err) => {

    console.error('SSE Error:', err);
  };
}

// Initial load
fetchBoard();
setupSSE();

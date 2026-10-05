const API_BASE = 'http://localhost:3000/api';
const app = document.getElementById('app');

let boardState = [];

async function fetchBoard() {
  const res = await fetch(`${API_BASE}/board`);
  boardState = await res.json();
  renderBoard();
}

function renderBoard() {
  app.innerHTML = '';
  
  boardState.forEach(column => {
    const colEl = document.createElement('div');
    colEl.className = 'column';
    colEl.dataset.id = column.id;
    
    colEl.innerHTML = `
      <div class="column-header">${column.title}</div>
      <div class="card-list" data-column-id="${column.id}"></div>
      <div class="add-card-form">
        <input type="text" placeholder="Add card..." id="input-${column.id}">
        <button id="btn-${column.id}">Add</button>
      </div>
    `;
    
    const cardList = colEl.querySelector('.card-list');
    
    // Sort cards by position
    const sortedCards = [...column.cards].sort((a, b) => a.position - b.position);
    
    sortedCards.forEach(card => {
      const cardEl = createCardElement(card);
      cardList.appendChild(cardEl);
    });
    
    app.appendChild(colEl);
    
    // Setup add card event
    const input = colEl.querySelector(`#input-${column.id}`);
    const btn = colEl.querySelector(`#btn-${column.id}`);
    
    const addCard = async () => {
      const text = input.value.trim();
      if (!text) return;
      
      // Optimistic update
      const tempId = 'temp-' + Date.now();
      const tempCard = { id: tempId, text, position: 999999, column_id: column.id };
      
      // Add to local state
      const col = boardState.find(c => c.id === column.id);
      col.cards.push(tempCard);
      renderBoard();
      
      try {
        const res = await fetch(`${API_BASE}/cards`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ columnId: column.id, text })
        });
        const newCard = await res.json();
        
        // Replace temp card with real card
        const cardIdx = col.cards.findIndex(c => c.id === tempId);
        if (cardIdx !== -1) col.cards[cardIdx] = newCard;
        renderBoard();
      } catch (e) {
        alert('Error adding card');
        col.cards = col.cards.filter(c => c.id !== tempId);
        renderBoard();
      }
      input.value = '';
    };
    
    btn.onclick = addCard;
    input.onkeypress = (e) => { if (e.key === 'Enter') addCard(); };
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
  
  el.addEventListener('dragstart', (e) => {
    e.target.classList.add('dragging');
    e.dataTransfer.setData('text/plain', card.id);
  });
  
  el.addEventListener('dragend', (e) => {
    e.target.classList.remove('dragging');
  });
  
  return el;
}

function setupDragAndDrop() {
  const cardLists = document.querySelectorAll('.card-list');
  
  cardLists.forEach(list => {
    list.addEventListener('dragover', (e) => {
      e.preventDefault();
      const draggingEl = document.querySelector('.dragging');
      if (!draggingEl) return;
      
      const afterElement = getDragAfterElement(list, e.clientY);
      if (afterElement == null) {
        list.appendChild(draggingEl);
      } else {
        list.insertBefore(draggingEl, afterElement);
      }
    });
    
    list.addEventListener('drop', async (e) => {
      e.preventDefault();
      const cardId = e.dataTransfer.getData('text/plain');
      const columnId = list.dataset.columnId;
      
      const cards = Array.from(list.querySelectorAll('.card'));
      const cardIdx = cards.findIndex(el => el.dataset.id === cardId);
      
      const beforeEl = cards[cardIdx - 1];
      const afterEl = cards[cardIdx + 1];
      
      const beforeId = beforeEl ? beforeEl.dataset.id : null;
      const afterId = afterEl ? afterEl.dataset.id : null;
      
      // Optimistic update: find and move card in local state
      let cardToMove = null;
      boardState.forEach(col => {
        const idx = col.cards.findIndex(c => c.id === cardId);
        if (idx !== -1) {
          cardToMove = col.cards.splice(idx, 1)[0];
        }
      });
      
      if (cardToMove) {
        const targetCol = boardState.find(col => col.id === columnId);
        // This is a rough optimistic position. The server will fix it.
        cardToMove.column_id = columnId;
        
        // Simple optimistic insertion: 
        // we don't have actual positions for before/after easily without re-fetching
        // but we can just push it into the array in the right place.
        // However, the renderBoard sorts by position, so we need a temporary position.
        
        // Find positions of neighbors
        const beforeCard = targetCol.cards.find(c => c.id === beforeId);
        const afterCard = targetCol.cards.find(c => c.id === afterId);
        
        let optPos = 1000;
        if (beforeCard && afterCard) {
          optPos = (beforeCard.position + afterCard.position) / 2;
        } else if (beforeCard) {
          optPos = beforeCard.position + 1000;
        } else if (afterCard) {
          optPos = afterCard.position - 1000;
        }
        
        cardToMove.position = optPos;
        
        // Insert into array at correct position to avoid immediate render jitter
        // Actually, the easiest way is just to let renderBoard sort it.
        targetCol.cards.push(cardToMove);
        
        // We don't call renderBoard immediately because the DOM already reflects the drop
        // but we want to keep state in sync.
      }
      
      try {
        const res = await fetch(`${API_BASE}/cards/${cardId}/move`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ columnId, beforeId, afterId })
        });
        const canonicalCard = await res.json();
        
        // Update state with canonical data
        const targetCol = boardState.find(col => col.id === columnId);
        const idx = targetCol.cards.findIndex(c => c.id === canonicalCard.id);
        if (idx !== -1) {
          targetCol.cards[idx] = canonicalCard;
        } else {
          targetCol.cards.push(canonicalCard);
        }
        
        // Re-render to ensure canonical order
        renderBoard();
      } catch (e) {
        alert('Error moving card');
        fetchBoard();
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
      return { offset: closest.offset, element: child };
    }
  }, { offset: Infinity });
}

// SSE Connection
function setupSSE() {
  const eventSource = new EventSource(`${API_BASE}/stream`);
  
  eventSource.addEventListener('cardCreated', (e) => {
    const newCard = JSON.parse(e.data);
    const col = boardState.find(c => c.id === newCard.column_id);
    if (col) {
      col.cards.push(newCard);
      renderBoard();
    }
  });
  
  eventSource.addEventListener('cardMoved', (e) => {
    const updatedCard = JSON.parse(e.data);
    const colId = updatedCard.column_id;
    
    // Remove from all columns
    boardState.forEach(col => {
      col.cards = col.cards.filter(c => c.id !== updatedCard.id);
    });
    
    // Add to target column
    const targetCol = boardState.find(col => col.id === colId);
    if (targetCol) {
      targetCol.cards.push(updatedCard);
      renderBoard();
    }
  });
}

async function init() {
  await fetchBoard();
  setupSSE();
}

init();

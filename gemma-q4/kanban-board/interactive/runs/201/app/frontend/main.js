const API_BASE = 'http://localhost:3000/api';
const boardEl = document.getElementById('board');

let boardState = [];

async function fetchBoard() {
  const res = await fetch(`${API_BASE}/board`);
  boardState = await res.json();
  renderBoard();
}

function renderBoard() {
  boardEl.innerHTML = '';
  boardState.forEach(col => {
    const colEl = document.createElement('div');
    colEl.className = 'column';
    colEl.dataset.id = col.id;
    
    colEl.innerHTML = `
      <div class="column-header">${col.title}</div>
      <div class="card-list" data-column-id="${col.id}"></div>
      <div class="add-card-form">
        <input type="text" placeholder="Add card..." class="card-input">
        <button class="add-btn">Add</button>
      </div>
    `;
    
    const listEl = colEl.querySelector('.card-list');
    col.cards.sort((a, b) => a.position - b.position).forEach(card => {
      listEl.appendChild(createCardElement(card));
    });
    
    const form = colEl.querySelector('.add-card-form');
    const input = form.querySelector('.card-input');
    const btn = form.querySelector('.add-btn');
    
    const addCard = async () => {
      const text = input.value.trim();
      if (!text) return;
      
      // Optimistic update: add to end of column locally
      const tempId = 'temp-' + Date.now();
      const tempCard = { id: tempId, text, position: (col.cards[col.cards.length-1]?.position || 0) + 1000 };
      col.cards.push(tempCard);
      listEl.appendChild(createCardElement(tempCard));
      input.value = '';
      
      try {
        const res = await fetch(`${API_BASE}/cards`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ columnId: col.id, text })
        });
        const serverCard = await res.json();
        
        // Replace temp card with server card
        const index = col.cards.findIndex(c => c.id === tempId);
        if (index !== -1) col.cards[index] = serverCard;
        
        // Update DOM
        const tempEl = listEl.querySelector(`[data-id="${tempId}"]`);
        if (tempEl) {
          const serverEl = createCardElement(serverCard);
          listEl.replaceChild(serverEl, tempEl);
        }
      } catch (err) {
        console.error('Error adding card:', err);
        // Remove optimistic card on error
        col.cards = col.cards.filter(c => c.id !== tempId);
        const tempEl = listEl.querySelector(`[data-id="${tempId}"]`);
        if (tempEl) tempEl.remove();
      }
    };
    
    btn.onclick = addCard;
    input.onkeydown = (e) => { if (e.key === 'Enter') addCard(); };
    
    boardEl.appendChild(colEl);
  });
}

function createCardElement(card) {
  const el = document.createElement('div');
  el.className = 'card';
  el.draggable = true;
  el.dataset.id = card.id;
  el.textContent = card.text;
  
  el.ondragstart = (e) => {
    e.dataTransfer.setData('text/plain', card.id);
    el.classList.add('dragging');
  };
  
  el.ondragend = () => {
    el.classList.remove('dragging');
  };
  
  return el;
}

// Drag and Drop Handling
boardEl.addEventListener('dragover', (e) => {
  e.preventDefault();
  const cardList = e.target.closest('.card-list');
  if (!cardList) return;
  
  const draggingEl = document.querySelector('.dragging');
  if (!draggingEl) return;
  
  const afterElement = getDragAfterElement(cardList, e.clientY);
  if (afterElement == null) {
    cardList.appendChild(draggingEl);
  } else {
    cardList.insertBefore(draggingEl, afterElement);
  }
});

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

boardEl.addEventListener('drop', async (e) => {
  e.preventDefault();
  const cardId = e.dataTransfer.getData('text/plain');
  const cardList = e.target.closest('.card-list');
  if (!cardList) return;
  
  const columnId = cardList.dataset.columnId;
  const draggingEl = document.querySelector(`[data-id="${cardId}"]`);
  if (!draggingEl) return;
  
  const children = [...cardList.children];
  const index = children.indexOf(draggingEl);
  const beforeEl = children[index - 1];
  const afterEl = children[index + 1];
  
  const beforeId = beforeEl ? beforeEl.dataset.id : null;
  const afterId = afterEl ? afterEl.dataset.id : null;
  
  try {
    const res = await fetch(`${API_BASE}/cards/${cardId}/move`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columnId, beforeId, afterId })
    });
    const updatedCard = await res.json();
    
    // Update local state
    const col = boardState.find(c => c.id === columnId);
    const cardIdx = boardState.flatMap(c => c.cards).findIndex(c => c.id === cardId);
    if (cardIdx !== -1) {
      const oldCol = boardState.find(c => c.cards.some(card => card.id === cardId));
      if (oldCol) oldCol.cards = oldCol.cards.filter(c => c.id !== cardId);
      col.cards.push(updatedCard);
    }
  } catch (err) {
    console.error('Error moving card:', err);
    fetchBoard(); // Revert to server state
  }
});

function initSSE() {
  const eventSource = new EventSource(`${API_BASE}/stream`);
  
  eventSource.addEventListener('cardCreated', (e) => {
    const card = JSON.parse(e.data);
    const col = boardState.find(c => c.id === card.columnId);
    if (col) {
      col.cards.push(card);
      renderBoard();
    } else {
      fetchBoard();
    }
  });
  
  eventSource.addEventListener('cardMoved', (e) => {
    const card = JSON.parse(e.data);
    
    // Remove card from all columns
    boardState.forEach(col => {
      col.cards = col.cards.filter(c => c.id !== card.id);
    });
    
    // Add to target column
    const targetCol = boardState.find(col => col.id === card.columnId);
    if (targetCol) {
      targetCol.cards.push(card);
    } else {
      return fetchBoard();
    }
    
    renderBoard();
  });
  
  eventSource.addEventListener('boardUpdated', (e) => {
    fetchBoard();
  });
}

fetchBoard().then(initSSE);

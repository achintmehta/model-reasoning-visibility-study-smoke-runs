const API_BASE = 'http://localhost:3000/api';

let boardState = [];

async function fetchBoard() {
  const res = await fetch(`${API_BASE}/board`);
  boardState = await res.json();
  renderBoard();
}

function renderBoard() {
  const app = document.getElementById('app');
  app.innerHTML = '';

  boardState.forEach(column => {
    const colEl = document.createElement('div');
    colEl.className = 'column';
    colEl.dataset.id = column.id;

    colEl.innerHTML = `
      <div class="column-header">${column.title}</div>
      <div class="card-list" data-column-id="${column.id}"></div>
      <div class="add-card-form">
        <input type="text" placeholder="Add card..." class="card-input">
        <button class="add-card-btn">Add</button>
      </div>
    `;

    const cardList = colEl.querySelector('.card-list');
    
    // Sort cards by position before rendering
    const sortedCards = [...column.cards].sort((a, b) => a.position - b.position);
    
    sortedCards.forEach(card => {
      cardList.appendChild(createCardElement(card));
    });

    // Add card event
    const input = colEl.querySelector('.card-input');
    const btn = colEl.querySelector('.add-card-btn');
    btn.onclick = () => addCard(column.id, input.value);
    input.onkeypress = (e) => {
      if (e.key === 'Enter') addCard(column.id, input.value);
    };

    app.appendChild(colEl);
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

async function addCard(columnId, text) {
  if (!text) return;
  
  // Optimistic update: we don't know the ID yet, so we just wait for the server
  // or we could add a placeholder. For simplicity, let's just call the API.
  const res = await fetch(`${API_BASE}/cards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ columnId, text })
  });
  
  if (!res.ok) alert('Failed to add card');
}

function setupDragAndDrop() {
  const lists = document.querySelectorAll('.card-list');
  
  lists.forEach(list => {
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
      const cardIdx = cards.findIndex(el => el.id === `card-${cardId}`);
      
      const beforeId = cardIdx > 0 ? cards[cardIdx - 1].dataset.id : null;
      const afterId = cardIdx < cards.length - 1 ? cards[cardIdx + 1].dataset.id : null;

      // The current DOM order is: [..., beforeId, currentCard, afterId, ...]
      // Wait, if we are inserting before 'afterElement', then 'afterElement' is afterId
      // and the element before the current one is beforeId.
      
      // Let's refine this:
      const currentCardEl = document.getElementById(`card-${cardId}`);
      const prev = currentCardEl.previousElementSibling;
      const next = currentCardEl.nextElementSibling;
      
      const before = prev ? prev.dataset.id : null;
      const after = next ? next.dataset.id : null;

      await fetch(`${API_BASE}/cards/${cardId}/move`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columnId, beforeId: before, afterId: after })
      });
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

function initSSE() {
  const eventSource = new EventSource(`${API_BASE}/stream`);

  eventSource.addEventListener('cardCreated', (e) => {
    const card = JSON.parse(e.data);
    const col = boardState.find(c => c.id === card.column_id);
    if (col) {
      col.cards.push(card);
      renderBoard();
    }
  });

  eventSource.addEventListener('cardMoved', (e) => {
    const updatedCard = JSON.parse(e.data);
    
    // Remove card from all columns
    boardState.forEach(col => {
      col.cards = col.cards.filter(c => c.id !== updatedCard.id);
    });
    
    // Add to new column
    const col = boardState.find(c => c.id === updatedCard.column_id);
    if (col) {
      col.cards.push(updatedCard);
    }
    
    renderBoard();
  });

  eventSource.addEventListener('columnRenormalized', (e) => {
    const { columnId, cards } = JSON.parse(e.data);
    const col = boardState.find(c => c.id === columnId);
    if (col) {
      // Replace the column's cards with the new normalized list
      col.cards = cards;
      renderBoard();
    }
  });
}

// Start
fetchBoard();
initSSE();

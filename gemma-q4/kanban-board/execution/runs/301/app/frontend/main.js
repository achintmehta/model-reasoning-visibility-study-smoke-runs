const API_BASE = 'http://localhost:3001/api';

let boardState = [];

async function fetchBoard() {
  const res = await fetch(`${API_BASE}/board`);
  boardState = await res.json();
  renderBoard();
}

function renderBoard() {
  const boardEl = document.getElementById('board');
  boardEl.innerHTML = '';

  boardState.forEach(col => {
    const colEl = document.createElement('div');
    colEl.className = 'column';
    colEl.dataset.id = col.id;

    colEl.innerHTML = `
      <div class="column-header">${col.title}</div>
      <div class="card-list" id="list-${col.id}"></div>
      <div class="card-form">
        <input type="text" placeholder="Add card..." id="input-${col.id}">
        <button id="add-${col.id}">Add</button>
      </div>
    `;

    const listEl = colEl.querySelector('.card-list');
    
    // Sort cards by position
    const sortedCards = [...col.cards].sort((a, b) => a.position - b.position);
    
    sortedCards.forEach(card => {
      listEl.appendChild(createCardElement(card));
    });

    boardEl.appendChild(colEl);

    // Add event listener for the add button
    colEl.querySelector(`#add-${col.id}`).onclick = () => addCard(col.id);
    colEl.querySelector(`#input-${col.id}`).onkeypress = (e) => {
      if (e.key === 'Enter') addCard(col.id);
    };
  });
}

function createCardElement(card) {
  const el = document.createElement('div');
  el.className = 'card';
  el.id = `card-${card.id}`;
  el.draggable = true;
  el.textContent = card.text;
  el.dataset.id = card.id;
  el.dataset.position = card.position;

  el.ondragstart = (e) => {
    e.dataTransfer.setData('text/plain', card.id);
    el.classList.add('dragging');
  };

  el.ondragend = () => {
    el.classList.remove('dragging');
  };

  return el;
}

async function addCard(columnId) {
  const input = document.getElementById(`input-${columnId}`);
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  
  // Optimistic add: just append it to the end of the list
  const listEl = document.getElementById(`list-${columnId}`);
  const tempId = 'temp-' + Date.now();
  const tempCard = document.createElement('div');
  tempCard.className = 'card';
  tempCard.id = `card-${tempId}`;
  tempCard.textContent = text;
  listEl.appendChild(tempCard);

  try {
    const res = await fetch(`${API_BASE}/cards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columnId, text })
    });
    const newCard = await res.json();
    
    // Replace optimistic card with real card
    const realCardEl = createCardElement(newCard);
    tempCard.replaceWith(realCardEl);
  } catch (err) {
    console.error('Failed to add card:', err);
    tempCard.remove();
  }
}

// Drag and Drop Logic
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  const card = document.querySelector('.dragging');
  if (!card) return;

  const list = e.target.closest('.card-list');
  if (!list) return;

  const afterElement = getDragAfterElement(list, e.clientY);
  if (afterElement == null) {
    list.appendChild(card);
  } else {
    list.insertBefore(card, afterElement);
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

document.addEventListener('drop', async (e) => {
  e.preventDefault();
  const cardEl = document.querySelector('.dragging');
  if (!cardEl) return;

  const cardId = cardEl.dataset.id;
  const listEl = cardEl.parentElement;
  if (!listEl || !listEl.classList.contains('card-list')) return;

  const columnId = listEl.id.replace('list-', '');
  const afterEl = cardEl.nextElementSibling;
  const beforeEl = cardEl.previousElementSibling;

  const beforeId = beforeEl ? beforeEl.dataset.id : null;
  const afterId = afterEl ? afterEl.dataset.id : null;

  // Note: my getDragAfterElement puts the card ABOVE the afterElement.
  // So if the card is at the top, beforeId is null.
  // If the card is at the bottom, afterId is null.
  // Wait, if card is inserted before afterElement, then afterElement is BELOW it.
  // Let's correct the IDs.
  
  // In my current DOM manipulation:
  // cardEl is the moved card.
  // beforeEl is the card above it.
  // afterEl is the card below it.
  
  const actualBeforeId = beforeEl ? beforeEl.dataset.id : null;
  const actualAfterId = afterEl ? afterEl.dataset.id : null;

  // The server API expects:
  // afterId: the card that will be ABOVE the moved card.
  // beforeId: the card that will be BELOW the moved card.
  
  try {
    const res = await fetch(`${API_BASE}/cards/${cardId}/move`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        columnId: columnId,
        beforeId: actualAfterId, // The one BELOW
        afterId: actualBeforeId   // The one ABOVE
      })
    });
    const canonicalCard = await res.json();
    
    // Update the card's position in the DOM state if needed
    cardEl.dataset.position = canonicalCard.position;
  } catch (err) {
    console.error('Failed to move card:', err);
    fetchBoard(); // Revert to server state on error
  }
});

// SSE Setup
function setupSSE() {
  const eventSource = new EventSource(`${API_BASE}/stream`);

  eventSource.addEventListener('cardCreated', (e) => {
    const card = JSON.parse(e.data);
    const listEl = document.getElementById(`list-${card.column_id}`);
    if (listEl) {
      // Only add if it doesn't exist (might be the optimistic one)
      if (!document.getElementById(`card-${card.id}`)) {
        listEl.appendChild(createCardElement(card));
        // Re-sort by position?
        sortList(listEl);
      }
    }
  });

  eventSource.addEventListener('cardMoved', (e) => {
    const card = JSON.parse(e.data);
    const listEl = document.getElementById(`list-${card.column_id}`);
    if (!listEl) return;

    const cardEl = document.getElementById(`card-${card.id}`);
    if (!cardEl) {
      // Card moved into this column from another one
      listEl.appendChild(createCardElement(card));
    } else {
      cardEl.dataset.position = card.position;
    }
    sortList(listEl);
  });

  eventSource.addEventListener('columnRenormalized', (e) => {
    const { columnId, cards } = JSON.parse(e.data);
    const listEl = document.getElementById(`list-${columnId}`);
    if (listEl) {
      listEl.innerHTML = '';
      cards.sort((a, b) => a.position - b.position).forEach(card => {
        listEl.appendChild(createCardElement(card));
      });
    }
  });
}

function sortList(listEl) {
  const cards = [...listEl.querySelectorAll('.card')];
  cards.sort((a, b) => parseFloat(a.dataset.position) - parseFloat(b.dataset.position));
  cards.forEach(card => listEl.appendChild(card));
}

// Init
fetchBoard();
setupSSE();

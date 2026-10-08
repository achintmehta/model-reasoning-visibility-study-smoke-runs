const API_BASE = 'http://localhost:3000/api';

let boardState = [];

async function loadBoard() {
  const res = await fetch(`${API_BASE}/board`);
  boardState = await res.json();
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
      <div class="card-list" data-column-id="${column.id}"></div>
      <div class="add-card-container">
        <input type="text" class="add-card-input" placeholder="Add a card...">
        <button class="add-card-button">Add</button>
      </div>
    `;

    const cardListEl = colEl.querySelector('.card-list');
    column.cards.forEach(card => {
      cardListEl.appendChild(createCardElement(card));
    });

    const input = colEl.querySelector('.add-card-input');
    const button = colEl.querySelector('.add-card-button');
    const addCardHandler = async () => {
      const text = input.value.trim();
      if (!text) return;
      
      // Optimistic update
      const tempId = 'temp-' + Date.now();
      const optimisticCard = { id: tempId, text, column_id: column.id, position: 999999 };
      cardListEl.appendChild(createCardElement(optimisticCard));
      input.value = '';

      try {
        await fetch(`${API_BASE}/cards`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ columnId: column.id, text })
        });
        // We'll remove the optimistic card when the real one arrives via SSE
        // or just let SSE handle it by re-rendering the column.
      } catch (err) {
        console.error('Error adding card:', err);
      }
    };

    button.onclick = addCardHandler;
    input.onkeypress = (e) => { if (e.key === 'Enter') addCardHandler(); };

    boardEl.appendChild(colEl);
  });

  setupDragAndDrop();
}

function createCardElement(card) {
  const el = document.createElement('div');
  el.className = 'card';
  el.draggable = true;
  el.id = card.id;
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

function setupDragAndDrop() {
  const lists = document.querySelectorAll('.card-list');
  
  lists.forEach(list => {
    list.ondragover = (e) => {
      e.preventDefault();
      const draggingEl = document.querySelector('.dragging');
      if (!draggingEl) return;

      const afterElement = getDragAfterElement(list, e.clientY);
      if (afterElement == null) {
        list.appendChild(draggingEl);
      } else {
        list.insertBefore(draggingEl, afterElement);
      }
    };

    list.ondrop = async (e) => {
      e.preventDefault();
      const cardId = e.dataTransfer.getData('text/plain');
      const columnId = list.dataset.columnId;
      
      const children = Array.from(list.children);
      const cardEl = children.find(el => el.id === cardId);
      if (!cardEl) return;
      
      const index = children.indexOf(cardEl);
      const beforeId = index > 0 ? children[index - 1].id : null;
      const afterId = index < children.length - 1 ? children[index + 1].id : null;

      try {
        await fetch(`${API_BASE}/cards/${cardId}/move`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ columnId, beforeId, afterId })
        });
      } catch (err) {
        console.error('Error moving card:', err);
      }
    };
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

function setupSSE() {
  const eventSource = new EventSource(`${API_BASE}/stream`);

  eventSource.addEventListener('card_created', (e) => {
    const card = JSON.parse(e.data);
    const list = document.querySelector(`.card-list[data-column-id="${card.column_id}"]`);
    if (list) {
      // Remove any optimistic card that might be there
      const optimisticCards = list.querySelectorAll('[id^="temp-"]');
      optimisticCards.forEach(oc => oc.remove());
      
      // Add the real card
      list.appendChild(createCardElement(card));
    }
  });

  eventSource.addEventListener('column_updated', (e) => {
    const { columnId, cards } = JSON.parse(e.data);
    const list = document.querySelector(`.card-list[data-column-id="${columnId}"]`);
    if (list) {
      list.innerHTML = '';
      cards.forEach(card => {
        list.appendChild(createCardElement(card));
      });
    }
  });
}

loadBoard();
setupSSE();

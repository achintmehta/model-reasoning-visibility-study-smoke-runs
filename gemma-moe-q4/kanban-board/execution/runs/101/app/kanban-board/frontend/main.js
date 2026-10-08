import './style.css'

/** @type {import('vite').UserConfig} */
const API_BASE = 'http://localhost:3001/api';
const SSE_URL = 'http://localhost:3001/api/stream';

async function fetchBoard() {
  const res = await fetch(`${API_BASE}/board`);
  return await res.json();
}

async function createCard(columnId, text) {
  const res = await fetch(`${API_BASE}/cards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ columnId, text })
  });
  return await res.json();
}

async function moveCard(cardId, { columnId, beforeId, afterId }) {
  const res = await fetch(`${API_BASE}/cards/${cardId}/move`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ columnId, beforeId, afterId })
  });
  return await res.json();
}

let boardState = [];

function renderBoard() {
  const container = document.querySelector('#app');
  if (!container) return;
  container.innerHTML = '';

  const boardEl = document.createElement('div');
  boardEl.className = 'board';

  boardState.forEach(column => {
    const colEl = document.createElement('div');
    colEl.className = 'column';
    colEl.dataset.id = column.id;

    const titleEl = document.createElement('h2');
    titleEl.textContent = column.title;
    colEl.appendChild(titleEl);

    const cardsContainer = document.createElement('div');
    cardsContainer.className = 'cards-container';
    cardsContainer.dataset.columnId = column.id;
    
    // Handle drag over
    cardsContainer.addEventListener('dragover', (e) => {
      e.preventDefault();
      const draggingCard = document.querySelector('.card.dragging');
      if (!draggingCard) return;

      const afterElement = getDragAfterElement(cardsContainer, e.clientY);
      if (afterElement == null) {
        cardsContainer.appendChild(draggingCard);
      } else {
        cardsContainer.insertBefore(draggingCard, afterElement);
      }
    });

    cardsContainer.addEventListener('drop', async (e) => {
      e.preventDefault();
      const draggingCard = document.querySelector('.card.dragging');
      if (!draggingCard) return;

      const columnId = cardsContainer.dataset.columnId;
      const cardId = draggingCard.dataset.id;

      // Find intended position in DOM
      const cardsInCol = Array.from(cardsContainer.children).filter(c => c.classList.contains('card'));
      const cardIdx = cardsInCol.indexOf(draggingCard);
      
      let beforeId = null;
      let afterId = null;
      
      if (cardIdx > 0) {
        beforeId = cardsInCol[cardIdx - 1].dataset.id;
      }
      if (cardIdx < cardsInCol.length - 1) {
        afterId = cardsInCol[cardIdx + 1].dataset.id;
      }

      try {
        await moveCard(cardId, { columnId, beforeId, afterId });
      } catch (err) {
        console.error('Failed to move card', err);
        // On error, reload board to sync
        const newState = await fetchBoard();
        boardState = newState;
        renderBoard();
      }
    });

    column.cards.forEach(card => {
      const cardEl = document.createElement('div');
      cardEl.className = 'card';
      cardEl.draggable = true;
      cardEl.dataset.id = card.id;
      cardEl.textContent = card.text;

      cardEl.addEventListener('dragstart', () => {
        cardEl.classList.add('dragging');
      });

      cardEl.addEventListener('dragend', () => {
        cardEl.classList.remove('dragging');
      });

      cardsContainer.appendChild(cardEl);
    });

    colEl.appendChild(cardsContainer);

    // Add card form
    const form = document.createElement('div');
    form.className = 'add-card-form';
    const input = document.createElement('input');
    input.placeholder = 'New card...';
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            if (input.value.trim()) {
                createCard(column.id, input.value.trim()).then(() => {
                    input.value = '';
                });
            }
        }
    });
    const btn = document.createElement('button');
    btn.textContent = 'Add';
    btn.onclick = () => {
      if (input.value.trim()) {
        createCard(column.id, input.value.trim());
        input.value = '';
      }
    };
    form.appendChild(input);
    form.appendChild(btn);
    colEl.appendChild(form);

    boardEl.appendChild(colEl);
  });

  container.appendChild(boardEl);
}

function getDragAfterElement(container, y) {
  const draggableElements = [...container.children].filter(c => c.classList.contains('card'));

  return draggableElements.reduce((afterElement, currentElement) => {
    const box = currentElement.getBoundingClientRect();
    const offset = y - (box.top + box.height / 2);
    
    if (offset < 0 && (afterElement === null || offset < afterElement.offset)) {
      return { element: currentElement, offset: offset };
    } else {
      return { element: afterElement, offset: afterElement ? afterElement.offset : Number.POSITIVE_INFINITY };
    }
  }, null)?.element || null;
}

async function init() {
  boardState = await fetchBoard();
  renderBoard();

  const eventSource = new EventSource(SSE_URL);
  eventSource.addEventListener('card_created', (event) => {
    console.log('Received card_created:', event.data);
    // Re-fetch everything to ensure complete synchronization
    // and avoid complex merge logic.
    fetchBoard().then(newState => {
      boardState = newState;
      renderBoard();
    });
  });

  eventSource.addEventListener('card_moved', (event) => {
    console.log('Received card_moved:', event.data);
    // Re-fetch everything to ensure complete synchronization
    fetchBoard().then(newState => {
        boardState = newState;
        renderBoard();
    });
  });

  eventSource.onerror = (err) => {
    console.error('SSE error:', err);
  };
}

init();

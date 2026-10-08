const API_BASE = 'http://localhost:3000/api';
const app = document.getElementById('app');

let boardState = [];

async function fetchBoard() {
  const res = await fetch(`${API_BASE}/board`);
  boardState = await res.json();
  render();
}

function render() {
  app.innerHTML = '';
  boardState.forEach(col => {
    const colEl = document.createElement('div');
    colEl.className = 'column';
    colEl.dataset.id = col.id;

    const header = document.createElement('div');
    header.className = 'column-header';
    header.innerText = col.title;
    colEl.appendChild(header);

    const cardList = document.createElement('div');
    cardList.className = 'card-list';
    cardList.dataset.id = col.id;
    cardList.addEventListener('dragover', handleDragOver);
    cardList.addEventListener('drop', handleDrop);

    col.cards.sort((a, b) => a.position - b.position).forEach(card => {
      const cardEl = document.createElement('div');
      cardEl.className = 'card';
      cardEl.draggable = true;
      cardEl.id = `card-${card.id}`;
      cardEl.innerText = card.text;
      cardEl.dataset.id = card.id;
      cardEl.addEventListener('dragstart', handleDragStart);
      cardEl.addEventListener('dragend', handleDragEnd);
      cardList.appendChild(cardEl);
    });

    colEl.appendChild(cardList);

    const form = document.createElement('div');
    form.className = 'add-card-form';
    const input = document.createElement('input');
    input.placeholder = 'New card...';
    const button = document.createElement('button');
    button.innerText = 'Add';
    button.onclick = () => addCard(col.id, input.value);
    
    form.appendChild(input);
    form.appendChild(button);
    colEl.appendChild(form);

    app.appendChild(colEl);
  });
}

async function addCard(columnId, text) {
  if (!text) return;
  const res = await fetch(`${API_BASE}/cards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ columnId, text })
  });
  const newCard = await res.json();
  
  // Optimistic update
  const col = boardState.find(c => c.id === columnId);
  col.cards.push(newCard);
  render();
}

let draggedCardId = null;

function handleDragStart(e) {
  draggedCardId = e.target.dataset.id;
  e.target.classList.add('dragging');
}

function handleDragEnd(e) {
  e.target.classList.remove('dragging');
}

function handleDragOver(e) {
  e.preventDefault();
  const list = e.currentTarget;
  const afterElement = getDragAfterElement(list, e.clientY);
  const dragging = document.querySelector('.dragging');
  if (!dragging) return;
  if (afterElement == null) {
    list.appendChild(dragging);
  } else {
    list.insertBefore(dragging, afterElement);
  }
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

async function handleDrop(e) {
  e.preventDefault();
  const columnId = e.currentTarget.dataset.id;
  const cardEl = document.querySelector('.dragging');
  if (!cardEl) return;
  const cardId = cardEl.dataset.id;

  const cardList = e.currentTarget;
  const cards = [...cardList.querySelectorAll('.card')];
  const index = cards.indexOf(cardEl);
  
  const beforeId = index > 0 ? cards[index - 1].dataset.id : null;
  const afterId = index < cards.length - 1 ? cards[index + 1].dataset.id : null;

  // Optimistic: the DOM is already updated by handleDragOver
  
  await fetch(`${API_BASE}/cards/${cardId}/move`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ columnId, beforeId, afterId })
  });
}

function setupSSE() {
  const eventSource = new EventSource(`${API_BASE}/stream`);
  
  eventSource.addEventListener('cardCreated', (e) => {
    const card = JSON.parse(e.data);
    const col = boardState.find(c => c.id === card.columnId);
    if (col) {
      col.cards.push(card);
      render();
    }
  });

  eventSource.addEventListener('cardMoved', (e) => {
    const card = JSON.parse(e.data);
    
    // Remove from any column it might be in
    boardState.forEach(col => {
      col.cards = col.cards.filter(c => c.id !== card.id);
    });
    
    // Add to target column
    const col = boardState.find(c => c.id === card.columnId);
    if (col) {
      // We need the full card data to render correctly (text)
      // For simplicity, we can either refetch board or find the card's old text
      // Let's try to find the text from existing state before we remove it
      const oldCard = boardState.flatMap(c => c.cards).find(c => c.id === card.id);
      const cardWithText = oldCard ? { ...card, text: oldCard.text } : card;
      
      col.cards.push(cardWithText);
      render();
    }
  });
}

fetchBoard();
setupSSE();

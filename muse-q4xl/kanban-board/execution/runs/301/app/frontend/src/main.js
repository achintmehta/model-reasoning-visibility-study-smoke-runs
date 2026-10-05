const API_BASE = 'http://localhost:3001/api';
let state = { columns: [] };

const appEl = document.getElementById('app');

async function loadBoard() {
  const res = await fetch(`${API_BASE}/board`);
  const data = await res.json();
  state.columns = data.columns;
  render();
}

function render() {
  appEl.innerHTML = '';
  state.columns.forEach(col => {
    const colEl = document.createElement('div');
    colEl.className = 'column';
    colEl.dataset.columnId = col.id;

    const title = document.createElement('h2');
    title.textContent = col.title;
    colEl.appendChild(title);

    const cardsContainer = document.createElement('div');
    cardsContainer.className = 'cards';
    cardsContainer.dataset.columnId = col.id;

    // sort cards by position
    const cards = [...col.cards].sort((a, b) => a.position - b.position);
    col.cards = cards;

    cards.forEach(card => {
      const cardEl = document.createElement('div');
      cardEl.className = 'card';
      cardEl.draggable = true;
      cardEl.dataset.cardId = card.id;
      cardEl.textContent = card.text;
      cardsContainer.appendChild(cardEl);
    });
    colEl.appendChild(cardsContainer);

    const addDiv = document.createElement('div');
    addDiv.className = 'add-card';
    const input = document.createElement('input');
    input.placeholder = 'New card';
    const btn = document.createElement('button');
    btn.textContent = 'Add';
    addDiv.appendChild(input);
    addDiv.appendChild(btn);
    colEl.appendChild(addDiv);

    appEl.appendChild(colEl);

    // add card handler
    btn.onclick = async () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      try {
        const res = await fetch(`${API_BASE}/cards`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ columnId: col.id, text })
        });
        if (!res.ok) throw new Error('Failed');
        // UI will update via SSE
      } catch (e) {
        console.error(e);
      }
    };

    // drag handlers
    cardsContainer.addEventListener('dragover', e => e.preventDefault());
    cardsContainer.addEventListener('drop', e => {
      e.preventDefault();
      const cardId = Number(e.dataTransfer.getData('text/plain'));
      if (!cardId) return;
      const targetColumnId = Number(colEl.dataset.columnId);
      // find insertion point based on mouse y
      const cardsEls = Array.from(cardsContainer.querySelectorAll('.card'));
      let insertBeforeId = null;
      let insertAfterId = null;
      const mouseY = e.clientY;
      for (const cEl of cardsEls) {
        const rect = cEl.getBoundingClientRect();
        if (mouseY < rect.top + rect.height / 2) {
          insertBeforeId = Number(cEl.dataset.cardId);
          insertAfterId = cardsEls.indexOf(cEl) > 0 ? Number(cardsEls[cardsEls.indexOf(cEl) - 1].dataset.cardId) : null;
          break;
        }
      }
      if (!insertBeforeId) {
        // append to end
        insertAfterId = cardsEls.length ? Number(cardsEls[cardsEls.length - 1].dataset.cardId) : null;
        insertBeforeId = null;
      }
      moveCardOptimistically(cardId, targetColumnId, insertBeforeId, insertAfterId);
      sendMove(cardId, targetColumnId, insertBeforeId, insertAfterId);
    });
  });

  // attach dragstart to cards
  appEl.querySelectorAll('.card').forEach(cardEl => {
    cardEl.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', cardEl.dataset.cardId);
      e.dataTransfer.effectAllowed = 'move';
      cardEl.classList.add('dragging');
    });
    cardEl.addEventListener('dragend', () => cardEl.classList.remove('dragging'));
  });
}

function findCard(cardId) {
  for (const col of state.columns) {
    const idx = col.cards.findIndex(c => c.id === cardId);
    if (idx !== -1) {
      return { column: col, index: idx, card: col.cards[idx] };
    }
  }
  return null;
}

function addCardToState(card) {
  const col = state.columns.find(c => c.id === card.columnId);
  if (col) {
    col.cards.push(card);
  } else {
    // create placeholder column?
  }
}

function moveCardOptimistically(cardId, targetColumnId, beforeId, afterId) {
  const found = findCard(cardId);
  if (!found) return;
  const { column: sourceCol, card } = found;
  // remove from source
  sourceCol.cards = sourceCol.cards.filter(c => c.id !== cardId);
  // update card columnId temporarily
  card.columnId = targetColumnId;
  // find target column
  const targetCol = state.columns.find(c => c.id === targetColumnId);
  if (!targetCol) return;
  // compute insertion index
  let insertIdx = targetCol.cards.length;
  if (beforeId) {
    const beforeIdx = targetCol.cards.findIndex(c => c.id === beforeId);
    insertIdx = beforeIdx >= 0 ? beforeIdx : targetCol.cards.length;
  } else if (afterId) {
    const afterIdx = targetCol.cards.findIndex(c => c.id === afterId);
    insertIdx = afterIdx >= 0 ? afterIdx + 1 : targetCol.cards.length;
  }
  targetCol.cards.splice(insertIdx, 0, card);
  render();
}

async function sendMove(cardId, columnId, beforeId, afterId) {
  try {
    await fetch(`${API_BASE}/cards/${cardId}/move`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        columnId,
        beforeId,
        afterId
      })
    });
  } catch (e) {
    console.error('Move failed', e);
  }
}

// SSE connection
let eventSource;
function connectSSE() {
  eventSource = new EventSource(`${API_BASE}/stream`);
  eventSource.addEventListener('card-created', e => {
    const { card } = JSON.parse(e.data);
    // Update state
    const col = state.columns.find(c => c.id === card.columnId);
    if (col) {
      // remove if already present
      col.cards = col.cards.filter(c => c.id !== card.id);
      col.cards.push(card);
    }
    render();
  });
  eventSource.addEventListener('card-moved', e => {
    const { card } = JSON.parse(e.data);
    // Remove from old location
    for (const col of state.columns) {
      col.cards = col.cards.filter(c => c.id !== card.id);
    }
    const targetCol = state.columns.find(c => c.id === card.columnId);
    if (targetCol) {
      targetCol.cards.push(card);
    }
    // Re-sort by position
    state.columns.forEach(col => {
      col.cards.sort((a, b) => a.position - b.position);
    });
    render();
  });
  eventSource.onerror = () => {
    console.warn('SSE error, reconnecting...');
    setTimeout(connectSSE, 2000);
  };
}

// Init
loadBoard().then(() => connectSSE());

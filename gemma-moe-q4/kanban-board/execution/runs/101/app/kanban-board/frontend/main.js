const API_BASE = 'http://localhost:3000/api';

let boardState = [];

const boardEl = document.getElementById('board');

async function fetchBoard() {
    const res = await fetch(`${API_BASE}/board`);
    boardState = await res.json();
    renderBoard();
}

function renderBoard() {
    boardEl.innerHTML = '';
    boardState.forEach(column => {
        const colEl = document.createElement('div');
        colEl.className = 'column';
        colEl.dataset.id = column.id;
        colEl.innerHTML = `
            <h2>${column.title}</h2>
            <div class="card-list" data-column-id="${column.id}"></div>
            <div class="card-form">
                <input type="text" placeholder="New card..." id="input-${column.id}">
                <button onclick="window.addCard('${column.id}')">Add</button>
            </div>
        `;

        const listEl = colEl.querySelector('.card-list');
        column.cards.forEach(card => {
            const cardEl = createCardElement(card);
            listEl.appendChild(cardEl);
        });

        // Drag and drop event listeners for the list
        listEl.addEventListener('dragover', handleDragOver);
        listEl.addEventListener('drop', handleDrop);

        boardEl.appendChild(colEl);
    });
}

function createCardElement(card) {
    const cardEl = document.createElement('div');
    cardEl.className = 'card';
    cardEl.draggable = true;
    cardEl.id = card.id;
    cardEl.textContent = card.text;
    
    cardEl.addEventListener('dragstart', handleDragStart);
    cardEl.addEventListener('dragend', handleDragEnd);
    
    return cardEl;
}

let draggedCardId = null;

function handleDragStart(e) {
    draggedCardId = e.target.id;
    e.target.classList.add('dragging');
}

function handleDragEnd(e) {
    e.target.classList.remove('dragging');
    draggedCardId = null;
}

async function handleDragOver(e) {
    e.preventDefault();
    const listEl = e.currentTarget;
    const afterElement = getDragAfterElement(listEl, e.clientY);
    
    // Visual feedback (optional, but good for UX)
    // We could add a drop indicator here
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
    const listEl = e.currentTarget;
    const columnId = listEl.dataset.columnId;
    const afterElement = getDragAfterElement(listEl, e.clientY);
    
    let beforeId = null;
    let afterId = null;

    if (afterElement) {
        // We want to drop before afterElement
        beforeId = afterElement.id;
    } else {
        // We want to drop at the end
        // To indicate "at the end", we can say it's after the last card
        const cards = listEl.querySelectorAll('.card');
        if (cards.length > 0) {
            afterId = cards[cards.length - 1].id;
        }
    }

    // If afterElement was found, it means we are dropping BEFORE it.
    // So in our API: beforeId = afterElement.id, afterId = null.
    // Wait, the API expects { columnId, beforeId, afterId } 
    // and calculates position BETWEEN afterId and beforeId.
    // So if we want to drop before X: beforeId = X, afterId = null.
    // If we want to drop after X: beforeId = null, afterId = X.
    // If we want to drop between X and Y: beforeId = Y, afterId = X.
    
    // Let's refine the logic based on our API:
    // beforeId: the card that should be BELOW.
    // afterId: the card that should be ABOVE.

    if (afterElement) {
        // We are dropping BEFORE afterElement.
        // So afterElement is the card that should be BELOW.
        beforeId = afterElement.id;
        afterId = null;
    } else {
        // We are dropping at the end.
        // To drop at the end, we need an afterId (the current last card) and beforeId = null.
        const cards = listEl.querySelectorAll('.card');
        if (cards.length > 0) {
            afterId = cards[cards.length - 1].id;
            beforeId = null;
        } else {
            // Empty list, drop anywhere
            afterId = null;
            beforeId = null;
        }
    }

    // Actually, if we are dropping BEFORE afterElement, 
    // we want afterElement to be BELOW the new card.
    // So beforeId = afterElement.id, afterId = null.
    // Let's re-read the API documentation again.
    // "accepting { columnId, beforeId, afterId }; the server computes the card's new position (between afterId and beforeId)"
    // If afterId = A and beforeId = B, newPos is between A and B.
    // If we want to drop BEFORE X: afterId = null, beforeId = X.
    // If we want to drop AFTER X: afterId = X, beforeId = null.
    // If we want to drop BETWEEN X and Y: afterId = X, beforeId = Y.
    
    // Let's re-evaluate the drop logic.
    // The `getDragAfterElement` returns the element that the dragged item would be placed BEFORE.
    // So if `afterElement` is returned, we want to be BEFORE `afterElement`.
    // Therefore: beforeId = afterElement.id, afterId = null.
    // Wait, the wording "between afterId and beforeId" means:
    // afterId is the one above, beforeId is the one below.
    // If we drop before X: afterId = null, beforeId = X.
    // If we drop after X: afterId = X, beforeId = null.
    // If we drop between X and Y: afterId = X, beforeId = Y.

    // If getDragAfterElement returns X, it means X is the first element that is below the cursor.
    // So we want to be BEFORE X.
    // Therefore: beforeId = X, afterId = null.
    // Wait, no. If we are BEFORE X, then X is BELOW us.
    // So beforeId = X, afterId = null.
    // If there is no element below us, we are at the end.
    // So afterId = lastCard.id, beforeId = null.
    
    // Let's try this:
    // 1. If getDragAfterElement returns X:
    //    We want to be BEFORE X. So X is BELOW. beforeId = X, afterId = null.
    //    Wait, if afterId is null, my server-side logic says:
    //    "if (beforeId) { minPos = ...; maxPos = pos(beforeId); } else { maxPos = Infinity; }"
    //    "if (afterId) { minPos = pos(afterId); } else { minPos = 0; }"
    //    So if beforeId = X and afterId = null: minPos = 0, maxPos = pos(X).
    //    The new card will be between 0 and pos(X). This is BEFORE X. Correct.
    
    // 2. If getDragAfterElement returns null:
    //    We want to be at the end.
    //    So afterId = lastCard.id, beforeId = null.
    //    Server-side: minPos = pos(lastCard), maxPos = Infinity.
    //    The new card will be after the last card. Correct.

    // Let's implement this.

    if (afterElement) {
        beforeId = afterElement.id;
        afterId = null;
    } else {
        const cards = listEl.querySelectorAll('.card');
        if (cards.length > 0) {
            afterId = cards[cards.length - 1].id;
            beforeId = null;
        } else {
            afterId = null;
            beforeId = null;
        }
    }

    // Optimistic update:
    // Since we don't have the exact new position from the server yet, 
    // we just move it in the DOM and hope for the best.
    // The SSE will eventually correct it.
    
    // For now, let's just call the API.
    try {
        await fetch(`${API_BASE}/cards/${draggedCardId}/move`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ columnId, beforeId, afterId })
        });
    } catch (err) {
        console.error('Move failed', err);
    }
}

window.addCard = async (columnId) => {
    const input = document.getElementById(`input-${columnId}`);
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    try {
        await fetch(`${API_BASE}/cards`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ columnId, text })
        });
    } catch (err) {
        console.error('Add card failed', err);
    }
};

// SSE Connection
const eventSource = new EventSource(`${API_BASE}/stream`);

eventSource.onmessage = (event) => {
    const { event: eventType, data } = JSON.parse(event.data);
    
    if (eventType === 'card_created') {
        // Add card to boardState and re-render
        const column = boardState.find(c => c.id === data.columnId);
        if (column) {
            column.cards.push({
                id: data.id,
                text: data.text,
                position: data.position
            });
            column.cards.sort((a, b) => a.position - b.position);
            renderBoard();
        }
    } else if (eventType === 'card_moved') {
        // Update card in boardState
        boardState.forEach(column => {
            const cardIdx = column.cards.findIndex(c => c.id === data.id);
            if (cardIdx !== -1) {
                column.cards.splice(cardIdx, 1);
            }
        });
        const column = boardState.find(c => c.id === data.columnId);
        if (column) {
            column.cards.push({
                id: data.id,
                text: data.text,
                position: data.position
            });
            column.cards.sort((a, b) => a.position - b.position);
        }
        renderBoard();
    } else if (eventType === 'column_updated') {
        // Update whole column
        const column = boardState.find(c => c.id === data.columnId);
        if (column) {
            column.cards = data.cards;
            renderBoard();
        }
    }
};

// Initial load
fetchBoard();

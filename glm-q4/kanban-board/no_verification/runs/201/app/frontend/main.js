// Kanban Board Application
class KanbanBoard {
  constructor() {
    this.board = null;
    this.eventSource = null;
    this.draggedCard = null;
    this.draggedFromColumn = null;
    this.draggedOverColumn = null;
    this.draggedAfterId = null;
    this.draggedBeforeId = null;
    this.cardElements = new Map();
    
    this.init();
  }

  async init() {
    this.bindEvents();
    this.connectToStream();
    await this.loadBoard();
  }

  bindEvents() {
    // Handle window events
    window.addEventListener('dragstart', this.handleDragStart.bind(this));
    window.addEventListener('dragend', this.handleDragEnd.bind(this));
    window.addEventListener('dragover', this.handleDragOver.bind(this));
    window.addEventListener('drop', this.handleDrop.bind(this));
    window.addEventListener('dragleave', this.handleDragLeave.bind(this));
  }

  async loadBoard() {
    try {
      const response = await fetch('/api/board');
      if (!response.ok) {
        throw new Error('Failed to load board');
      }
      this.board = await response.json();
      this.render();
      this.updateConnectionStatus(true);
    } catch (error) {
      console.error('Error loading board:', error);
      this.updateConnectionStatus(false);
      this.showNotification('Failed to load board. Please refresh the page.');
    }
  }

  connectToStream() {
    this.eventSource = new EventSource('/api/stream');
    
    this.eventSource.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleStreamMessage(data);
      } catch (error) {
        console.error('Error parsing stream message:', error);
      }
    });

    this.eventSource.addEventListener('error', (error) => {
      console.error('SSE error:', error);
      this.updateConnectionStatus(false);
    });

    this.eventSource.addEventListener('open', () => {
      this.updateConnectionStatus(true);
    });
  }

  handleStreamMessage(data) {
    switch (data.type) {
      case 'card-created':
        this.handleCardCreated(data.card);
        break;
      case 'card-moved':
        this.handleCardMoved(data.card);
        break;
      default:
        console.log('Unknown message type:', data.type);
    }
  }

  handleCardCreated(card) {
    if (this.board) {
      const column = this.board.find(col => col.id === card.column_id);
      if (column) {
        column.cards.push(card);
        this.sortColumn(column);
        this.renderCard(column.id, card);
      }
    }
  }

  handleCardMoved(card) {
    if (this.board) {
      const oldColumn = this.board.find(col => col.id === card.column_id);
      const newColumn = this.board.find(col => col.id === card.column_id);
      
      if (oldColumn && newColumn && oldColumn !== newColumn) {
        // Remove from old column
        const oldIndex = oldColumn.cards.findIndex(c => c.id === card.id);
        if (oldIndex > -1) {
          oldColumn.cards.splice(oldIndex, 1);
        }
        
        // Add to new column
        newColumn.cards.push(card);
      }
      
      this.sortColumn(oldColumn);
      this.sortColumn(newColumn);
      this.renderCard(newColumn.id, card);
    }
  }

  render() {
    const app = document.getElementById('app');
    app.innerHTML = `
      <div class="container">
        <h1>📋 Collaborative Kanban Board</h1>
        <div class="board"></div>
      </div>
      <div class="connection-status ${this.eventSource ? 'connected' : 'disconnected'}">
        ${this.eventSource ? '● Connected' : '● Disconnected'}
      </div>
    `;

    const board = document.querySelector('.board');
    this.board.forEach(column => {
      this.renderColumn(board, column);
    });
  }

  renderColumn(container, column) {
    const columnElement = document.createElement('div');
    columnElement.className = 'column';
    columnElement.dataset.columnId = column.id;

    const header = document.createElement('div');
    header.className = 'column-header';
    header.innerHTML = `
      <span class="column-title">${column.title}</span>
      <span class="card-count">${column.cards.length}</span>
    `;

    const cardList = document.createElement('div');
    cardList.className = 'card-list';

    column.cards.forEach(card => {
      this.renderCardElement(cardList, card, column.id);
    });

    const addCardForm = document.createElement('div');
    addCardForm.className = 'add-card-form';
    addCardForm.innerHTML = `
      <input 
        type="text" 
        class="add-card-input" 
        placeholder="Add a card..." 
        data-column-id="${column.id}"
      >
      <button class="add-card-button" data-column-id="${column.id}">Add</button>
    `;

    columnElement.appendChild(header);
    columnElement.appendChild(cardList);
    columnElement.appendChild(addCardForm);
    container.appendChild(columnElement);

    // Bind add card events
    const input = addCardForm.querySelector('.add-card-input');
    const button = addCardForm.querySelector('.add-card-button');
    
    const handleAddCard = async () => {
      const text = input.value.trim();
      if (text) {
        try {
          const response = await fetch('/api/cards', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              columnId: column.id,
              text: text
            })
          });

          if (response.ok) {
            const card = await response.json();
            column.cards.push(card);
            this.sortColumn(column);
            this.renderCard(column.id, card);
            input.value = '';
          }
        } catch (error) {
          console.error('Error creating card:', error);
          this.showNotification('Failed to create card');
        }
      }
    };

    button.addEventListener('click', handleAddCard);
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        handleAddCard();
      }
    });
  }

  renderCardElement(container, card, columnId) {
    const cardElement = document.createElement('div');
    cardElement.className = 'card';
    cardElement.dataset.cardId = card.id;
    cardElement.dataset.columnId = columnId;
    
    const date = new Date(card.created_at);
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    cardElement.innerHTML = `
      <div class="card-text">${this.escapeHtml(card.text)}</div>
      <div class="card-created">Created ${timeStr}</div>
    `;

    container.appendChild(cardElement);
    this.cardElements.set(card.id, cardElement);
  }

  renderCard(columnId, card) {
    const cardElement = this.cardElements.get(card.id);
    const column = this.board.find(col => col.id === columnId);
    
    if (cardElement && column) {
      // Remove old position
      const oldParent = cardElement.parentElement;
      if (oldParent) {
        oldParent.removeChild(cardElement);
      }
      
      // Add to new parent with correct position
      const cardList = oldParent.querySelector('.card-list');
      if (cardList) {
        const insertBefore = this.findInsertionIndex(column.cards, card);
        this.insertCardAtPosition(cardList, cardElement, insertBefore);
      }
      
      // Update card count
      const header = oldParent.querySelector('.column-header');
      if (header) {
        const countElement = header.querySelector('.card-count');
        if (countElement) {
          countElement.textContent = column.cards.length;
        }
      }
    }
  }

  findInsertionIndex(cards, card) {
    const cardIndex = cards.findIndex(c => c.id === card.id);
    if (cardIndex === -1) return cards.length;
    
    // Find the element before this card
    if (cardIndex > 0) {
      return cards[cardIndex - 1].id;
    }
    
    return null;
  }

  insertCardAtPosition(container, cardElement, beforeId) {
    const existingCard = this.cardElements.get(card.id);
    if (existingCard) {
      existingCard.remove();
    }

    this.cardElements.set(card.id, cardElement);

    if (beforeId) {
      const beforeElement = container.querySelector(`[data-card-id="${beforeId}"]`);
      if (beforeElement) {
        container.insertBefore(cardElement, beforeElement);
      } else {
        container.appendChild(cardElement);
      }
    } else {
      container.appendChild(cardElement);
    }
  }

  sortColumn(column) {
    column.cards.sort((a, b) => a.position - b.position);
  }

  handleDragStart(e) {
    const card = e.target.closest('.card');
    if (!card) return;

    this.draggedCard = card;
    this.draggedFromColumn = card.dataset.columnId;
    
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.dataset.cardId);
    
    card.classList.add('dragging');
    
    // Set drag image
    const dragImage = card.cloneNode(true);
    dragImage.style.position = 'fixed';
    dragImage.style.pointerEvents = 'none';
    dragImage.style.zIndex = '9999';
    dragImage.style.opacity = '0.9';
    dragImage.style.transform = 'scale(1.1)';
    document.body.appendChild(dragImage);
    e.dataTransfer.setDragImage(dragImage, 50, 50);
    setTimeout(() => dragImage.remove(), 0);
  }

  handleDragEnd(e) {
    if (this.draggedCard) {
      this.draggedCard.classList.remove('dragging');
      this.draggedCard = null;
    }

    document.querySelectorAll('.drag-over').forEach(el => {
      el.classList.remove('drag-over');
    });

    this.draggedFromColumn = null;
    this.draggedOverColumn = null;
    this.draggedAfterId = null;
    this.draggedBeforeId = null;
  }

  handleDragOver(e) {
    e.preventDefault();
    
    const column = e.target.closest('.column');
    if (!column) return;

    this.draggedOverColumn = column.dataset.columnId;

    // Find the card being dragged over
    const card = e.target.closest('.card');
    if (card) {
      const cardId = card.dataset.cardId;
      
      // Determine whether we're dragging before or after this card
      const rect = card.getBoundingClientRect();
      const midPoint = rect.top + rect.height / 2;
      
      if (e.clientY < midPoint) {
        this.draggedBeforeId = cardId;
        this.draggedAfterId = null;
      } else {
        this.draggedBeforeId = null;
        this.draggedAfterId = cardId;
      }
    }

    // Add visual feedback
    document.querySelectorAll('.column').forEach(col => {
      col.classList.remove('drag-over');
      if (col.dataset.columnId === this.draggedOverColumn) {
        col.classList.add('drag-over');
      }
    });
  }

  handleDragLeave(e) {
    const column = e.target.closest('.column');
    if (column && column.dataset.columnId === this.draggedOverColumn) {
      column.classList.remove('drag-over');
    }
  }

  async handleDrop(e) {
    e.preventDefault();
    
    if (!this.draggedCard || !this.draggedOverColumn) {
      return;
    }

    const cardId = this.draggedCard.dataset.cardId;
    const fromColumnId = this.draggedFromColumn;
    const toColumnId = this.draggedOverColumn;

    if (fromColumnId === toColumnId) {
      // Same column - reorder
      await this.moveCard(cardId, toColumnId, this.draggedAfterId, this.draggedBeforeId);
    } else {
      // Different column - move
      await this.moveCard(cardId, toColumnId, this.draggedAfterId, this.draggedBeforeId);
    }

    // Clear visual feedback
    document.querySelectorAll('.column').forEach(col => {
      col.classList.remove('drag-over');
    });
  }

  async moveCard(cardId, columnId, afterId, beforeId) {
    try {
      const response = await fetch(`/api/cards/${cardId}/move`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          columnId,
          beforeId,
          afterId
        })
      });

      if (!response.ok) {
        throw new Error('Failed to move card');
      }

      const card = await response.json();
      
      // Optimistic update
      if (this.board) {
        const fromColumn = this.board.find(col => col.id === card.column_id);
        const toColumn = this.board.find(col => col.id === card.column_id);
        
        if (fromColumn && fromColumn !== toColumn) {
          const index = fromColumn.cards.findIndex(c => c.id === card.id);
          if (index > -1) {
            fromColumn.cards.splice(index, 1);
          }
          toColumn.cards.push(card);
        }
        
        this.sortColumn(fromColumn);
        this.sortColumn(toColumn);
        this.renderCard(card.column_id, card);
      }
    } catch (error) {
      console.error('Error moving card:', error);
      this.showNotification('Failed to move card. Syncing...');
      
      // Reload board to get canonical state
      await this.loadBoard();
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  showNotification(message) {
    const existing = document.querySelector('.notification');
    if (existing) {
      existing.remove();
    }

    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.remove();
    }, 3000);
  }

  updateConnectionStatus(connected) {
    const status = document.querySelector('.connection-status');
    if (status) {
      status.classList.toggle('connected', connected);
      status.classList.toggle('disconnected', !connected);
      status.textContent = connected ? '● Connected' : '● Disconnected';
    }
  }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
  new KanbanBoard();
});

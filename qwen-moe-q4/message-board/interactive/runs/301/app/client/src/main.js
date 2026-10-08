// DOM Elements
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const submitBtn = document.getElementById('submit-btn');
const messagesContainer = document.getElementById('messages-container');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const errorMessage = document.getElementById('error-message');

// State
let lastMessageId = null;

// Format timestamp for display
function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);

  if (diffSec < 60) {
    return 'just now';
  } else if (diffMin < 60) {
    return `${diffMin}m ago`;
  } else if (diffHour < 24) {
    return `${diffHour}h ago`;
  } else {
    return date.toLocaleDateString();
  }
}

// Render a single message
function renderMessage(message) {
  const div = document.createElement('div');
  div.className = 'message-item';
  div.dataset.id = message.id;
  div.innerHTML = `
    <div class="message-text">${escapeHtml(message.text)}</div>
    <div class="message-time">${formatTime(message.created_at)}</div>
  `;
  return div;
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Show error message
function showError(msg) {
  errorMessage.textContent = msg;
  errorMessage.classList.add('visible');
  setTimeout(() => {
    errorMessage.classList.remove('visible');
  }, 5000);
}

// Fetch and render initial messages
async function loadMessages() {
  try {
    const response = await fetch('/api/messages');
    if (!response.ok) {
      throw new Error('Failed to fetch messages');
    }
    const messages = await response.json();
    
    if (messages.length === 0) {
      messagesContainer.innerHTML = `
        <div class="empty-state">
          <p>No messages yet. Be the first to post!</p>
        </div>
      `;
    } else {
      messagesContainer.innerHTML = '';
      messages.forEach(msg => {
        messagesContainer.appendChild(renderMessage(msg));
      });
      // Track the last message ID
      lastMessageId = messages[messages.length - 1].id;
    }
  } catch (error) {
    console.error('Error loading messages:', error);
    showError('Failed to load messages');
  }
}

// Connect to SSE stream
function connectToStream() {
  const eventSource = new EventSource('/api/stream');

  eventSource.addEventListener('connected', (event) => {
    console.log('SSE connection established');
    statusDot.className = 'connection-status connected';
    statusText.textContent = 'Connected';
  });

  eventSource.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);
    
    // Only add if this is a new message we haven't seen
    if (!lastMessageId || data.id > lastMessageId) {
      lastMessageId = data.id;
      
      // Remove empty state if it exists
      const emptyState = messagesContainer.querySelector('.empty-state');
      if (emptyState) {
        emptyState.remove();
      }
      
      // Append new message
      const messageEl = renderMessage(data);
      messagesContainer.appendChild(messageEl);
      
      // Scroll to bottom
      messageEl.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  });

  eventSource.onerror = (error) => {
    console.error('SSE connection error:', error);
    statusDot.className = 'connection-status disconnected';
    statusText.textContent = 'Reconnecting...';
    
    // Close and try to reconnect
    eventSource.close();
    
    // Retry after 3 seconds
    setTimeout(() => {
      console.log('Attempting to reconnect...');
      connectToStream();
    }, 3000);
  };

  return eventSource;
}

// Submit message
async function submitMessage(event) {
  event.preventDefault();
  
  const text = messageInput.value.trim();
  if (!text) return;

  // Disable form during submission
  submitBtn.disabled = true;
  submitBtn.textContent = 'Posting...';

  try {
    const response = await fetch('/api/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text })
    });

    if (!response.ok) {
      throw new Error('Failed to post message');
    }

    const newMessage = await response.json();
    
    // Update last message ID
    lastMessageId = newMessage.id;
    
    // Remove empty state if it exists
    const emptyState = messagesContainer.querySelector('.empty-state');
    if (emptyState) {
      emptyState.remove();
    }
    
    // Append new message
    const messageEl = renderMessage(newMessage);
    messagesContainer.appendChild(messageEl);
    
    // Scroll to bottom
    messageEl.scrollIntoView({ behavior: 'smooth', block: 'end' });
    
    // Clear input
    messageInput.value = '';
    messageInput.focus();
  } catch (error) {
    console.error('Error posting message:', error);
    showError('Failed to post message. Please try again.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Post Message';
  }
}

// Initialize
loadMessages();
connectToStream();
messageForm.addEventListener('submit', submitMessage);

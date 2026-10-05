// DOM elements
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const messageList = document.getElementById('message-list');
const emptyState = document.getElementById('empty-state');
const statusBar = document.getElementById('status-bar');
const statusText = document.getElementById('status-text');

// State
let eventSource = null;

// Format a timestamp into a readable string
function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  const timeStr = date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });

  if (isToday) {
    return `Today at ${timeStr}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return `Yesterday at ${timeStr}`;
  }

  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
  }) + ` at ${timeStr}`;
}

// Create a message element
function createMessageElement(message) {
  const div = document.createElement('div');
  div.className = 'message-item';
  div.dataset.id = message.id;

  const textDiv = document.createElement('div');
  textDiv.className = 'message-text';
  textDiv.textContent = message.text;

  const timeDiv = document.createElement('div');
  timeDiv.className = 'message-time';
  timeDiv.textContent = formatTime(message.created_at);

  div.appendChild(textDiv);
  div.appendChild(timeDiv);

  return div;
}

// Update empty state visibility
function updateEmptyState() {
  const messages = messageList.querySelectorAll('.message-item');
  if (messages.length === 0) {
    emptyState.style.display = 'block';
  } else {
    emptyState.style.display = 'none';
  }
}

// Set connection status
function setStatus(connected) {
  statusBar.className = `status-bar ${connected ? 'connected' : 'disconnected'}`;
  statusText.textContent = connected ? 'Live' : 'Disconnected';
}

// Fetch initial messages from the API
async function fetchMessages() {
  try {
    const response = await fetch('/api/messages');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const messages = await response.json();

    // Clear existing messages (except empty state)
    messageList.querySelectorAll('.message-item').forEach(el => el.remove());

    // Render all messages
    for (const message of messages) {
      messageList.appendChild(createMessageElement(message));
    }

    updateEmptyState();
  } catch (err) {
    console.error('Failed to fetch messages:', err);
    statusText.textContent = 'Error loading messages';
  }
}

// Connect to SSE stream
function connectSSE() {
  // Close existing connection if any
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource('/api/stream');

  eventSource.onopen = () => {
    setStatus(true);
  };

  eventSource.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      messageList.appendChild(createMessageElement(message));
      updateEmptyState();

      // Scroll to bottom to show new message
      messageList.scrollTop = messageList.scrollHeight;
    } catch (err) {
      console.error('Failed to parse SSE message:', err);
    }
  };

  eventSource.onerror = () => {
    setStatus(false);
    // EventSource will automatically reconnect
  };
}

// Post a new message
async function postMessage(text) {
  try {
    const response = await fetch('/api/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to post message');
    }

    // Clear the input
    messageInput.value = '';
    messageInput.focus();
  } catch (err) {
    console.error('Failed to post message:', err);
    alert(err.message || 'Failed to post message. Please try again.');
  }
}

// Event listeners
messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (text) {
    postMessage(text);
  }
});

// Initialize
fetchMessages();
connectSSE();

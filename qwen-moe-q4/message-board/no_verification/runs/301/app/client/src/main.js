const API_BASE = 'http://localhost:3000';

const messageList = document.getElementById('message-list');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const connectionStatus = document.getElementById('connection-status');

// Format timestamp for display
function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Create and append a message element to the list
function appendMessage(msg) {
  const li = document.createElement('li');
  li.innerHTML = `
    <div class="message-text">${escapeHtml(msg.text)}</div>
    <div class="message-time">${formatTime(msg.created_at)}</div>
  `;
  messageList.appendChild(li);

  // Remove empty state if present
  const emptyState = messageList.querySelector('.empty-state');
  if (emptyState) {
    emptyState.remove();
  }

  // Scroll to bottom
  li.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Fetch and render initial message history
async function loadMessages() {
  try {
    const response = await fetch(`${API_BASE}/api/messages`);
    if (!response.ok) throw new Error('Failed to fetch messages');

    const messages = await response.json();

    // Clear the list first
    messageList.innerHTML = '';

    if (messages.length === 0) {
      messageList.innerHTML = '<li class="empty-state">No messages yet. Be the first to post!</li>';
      return;
    }

    messages.forEach((msg) => appendMessage(msg));
  } catch (err) {
    console.error('Error loading messages:', err);
  }
}

// Connect to SSE stream for real-time updates
function connectToStream() {
  const eventSource = new EventSource(`${API_BASE}/api/stream`);

  eventSource.onopen = () => {
    connectionStatus.textContent = '● Connected';
    connectionStatus.className = 'status connected';
  };

  eventSource.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      appendMessage(msg);
    } catch (err) {
      console.error('Error parsing SSE message:', err);
    }
  };

  eventSource.onerror = () => {
    connectionStatus.textContent = '● Disconnected';
    connectionStatus.className = 'status disconnected';
    eventSource.close();

    // Attempt to reconnect after a delay
    setTimeout(() => {
      console.log('Reconnecting...');
      connectToStream();
    }, 3000);
  };

  // Store reference for cleanup if needed
  window.eventSource = eventSource;
}

// Handle form submission to post a new message
messageForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const text = messageInput.value.trim();
  if (!text) return;

  try {
    const response = await fetch(`${API_BASE}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to post message');
    }

    // Clear input after successful post
    messageInput.value = '';
    messageInput.focus();
  } catch (err) {
    console.error('Error posting message:', err);
    alert('Failed to post message: ' + err.message);
  }
});

// Initialize the application
loadMessages();
connectToStream();

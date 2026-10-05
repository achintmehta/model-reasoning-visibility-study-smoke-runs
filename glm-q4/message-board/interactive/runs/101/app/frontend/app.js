// DOM elements
const messageForm = document.getElementById('messageForm');
const messageInput = document.getElementById('messageInput');
const messagesList = document.getElementById('messagesList');

// State
let messages = [];

// Fetch initial messages
async function fetchMessages() {
  try {
    const response = await fetch('/api/messages');
    if (!response.ok) {
      throw new Error('Failed to fetch messages');
    }
    messages = await response.json();
    renderMessages();
  } catch (error) {
    console.error('Error fetching messages:', error);
    messagesList.innerHTML = '<li class="empty-state">Failed to load messages. Please refresh the page.</li>';
  }
}

// Render messages to the DOM
function renderMessages() {
  if (messages.length === 0) {
    messagesList.innerHTML = '<li class="empty-state">No messages yet. Be the first to post!</li>';
    return;
  }

  messagesList.innerHTML = messages.map(message => `
    <li class="message">
      <div class="message-header">
        <span>${new Date(message.created_at).toLocaleString()}</span>
      </div>
      <div class="message-text">${escapeHtml(message.text)}</div>
    </li>
  `).join('');
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Send a new message
async function sendMessage(text) {
  try {
    const response = await fetch('/api/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      throw new Error('Failed to send message');
    }

    const newMessage = await response.json();
    messages.push(newMessage);
    renderMessages();
    messageInput.value = '';
    messageInput.focus();
  } catch (error) {
    console.error('Error sending message:', error);
    alert('Failed to send message');
  }
}

// Connect to SSE stream
function connectToStream() {
  const eventSource = new EventSource('/api/stream');

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      
      if (data.type === 'new_message' && data.message) {
        messages.push(data.message);
        renderMessages();
      } else if (Array.isArray(data)) {
        // Initial data payload
        messages = data;
        renderMessages();
      }
    } catch (error) {
      console.error('Error parsing SSE data:', error);
    }
  };

  eventSource.onerror = (error) => {
    console.error('SSE error:', error);
    eventSource.close();
  };

  return eventSource;
}

// Event listeners
messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (text) {
    sendMessage(text);
  }
});

// Initialize
fetchMessages();
const eventSource = connectToStream();

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  eventSource.close();
});

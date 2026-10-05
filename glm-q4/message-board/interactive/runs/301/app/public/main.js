// DOM elements
const messageList = document.getElementById('message-list');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');

// Base URL for API
const API_BASE = 'http://localhost:3001';

// State
let messages = [];
let eventSource = null;

// Render a single message
function renderMessage(message) {
  const messageElement = document.createElement('div');
  messageElement.className = 'message';
  messageElement.dataset.id = message.id;

  const time = new Date(message.created_at).toLocaleTimeString();

  messageElement.innerHTML = `
    <div class="message-content">${escapeHtml(message.text)}</div>
    <div class="message-time">${time}</div>
  `;

  // Insert at the top of the list
  messageList.insertBefore(messageElement, messageList.firstChild);
}

// Render all messages
function renderMessages() {
  messageList.innerHTML = '';
  messages.forEach(message => renderMessage(message));
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Fetch initial messages
async function fetchMessages() {
  try {
    const response = await fetch(`${API_BASE}/api/messages`);
    if (!response.ok) {
      throw new Error('Failed to fetch messages');
    }
    messages = await response.json();
    renderMessages();
  } catch (error) {
    console.error('Error fetching messages:', error);
    messageList.innerHTML = '<p class="error">Failed to load messages. Please refresh the page.</p>';
  }
}

// Connect to SSE stream
function connectToStream() {
  eventSource = new EventSource(`${API_BASE}/api/stream`);

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      if (data.event === 'ping') {
        // Heartbeat - ignore
        return;
      }

      if ('id' in data && 'text' in data && 'created_at' in data) {
        // New message received
        messages.push(data);
        renderMessage(data);
      }
    } catch (error) {
      console.error('Error processing SSE message:', error);
    }
  };

  eventSource.onerror = (error) => {
    console.error('SSE error:', error);
    eventSource.close();
    // Reconnect after 5 seconds
    setTimeout(connectToStream, 5000);
  };

  console.log('Connected to SSE stream');
}

// Send a new message
async function sendMessage(text) {
  try {
    const response = await fetch(`${API_BASE}/api/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to send message');
    }

    const newMessage = await response.json();
    messages.push(newMessage);
    renderMessage(newMessage);
    messageInput.value = '';
  } catch (error) {
    console.error('Error sending message:', error);
    alert('Failed to send message. Please try again.');
  }
}

// Handle form submission
messageForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (text) {
    sendMessage(text);
  }
});

// Initialize the app
console.log('Initializing message board...');
fetchMessages();
connectToStream();

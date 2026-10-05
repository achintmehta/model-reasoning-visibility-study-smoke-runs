// DOM elements
const messageList = document.getElementById('messageList');
const messageForm = document.getElementById('messageForm');
const messageInput = document.getElementById('messageInput');

const API_URL = window.location.origin;

// Fetch initial messages
async function loadMessages() {
  try {
    const response = await fetch(`${API_URL}/api/messages`);
    const messages = await response.json();

    messageList.innerHTML = '';
    messages.forEach(message => {
      const messageEl = createMessageElement(message);
      messageList.appendChild(messageEl);
    });

    // Scroll to bottom
    messageList.scrollTop = messageList.scrollHeight;
  } catch (error) {
    console.error('Error loading messages:', error);
  }
}

// Create message DOM element
function createMessageElement(message) {
  const div = document.createElement('div');
  div.className = 'message';

  const timestamp = new Date(message.created_at).toLocaleString();

  div.innerHTML = `
    <div class="timestamp">${timestamp}</div>
    <div class="text">${escapeHtml(message.text)}</div>
  `;

  return div;
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Connect to SSE stream
function connectToStream() {
  const eventSource = new EventSource(`${API_URL}/api/stream`);

  eventSource.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      const messageEl = createMessageElement(message);
      messageList.appendChild(messageEl);

      // Scroll to bottom
      messageList.scrollTop = messageList.scrollHeight;
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  };

  eventSource.onerror = (error) => {
    console.error('SSE error:', error);
    // SSE will reconnect automatically
  };

  return eventSource;
}

// Handle form submission
messageForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const text = messageInput.value.trim();
  if (!text) return;

  try {
    const response = await fetch(`${API_URL}/api/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });

    if (response.ok) {
      messageInput.value = '';
    } else {
      console.error('Failed to post message');
    }
  } catch (error) {
    console.error('Error posting message:', error);
  }
});

// Initialize
loadMessages();
connectToStream();

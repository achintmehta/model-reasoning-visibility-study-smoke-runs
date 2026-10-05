const API_BASE = '';

const messageList = document.getElementById('message-list');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');

// Render a single message element and return it
function createMessageElement(message) {
  const div = document.createElement('div');
  div.className = 'message';
  div.dataset.id = message.id;

  const textEl = document.createElement('div');
  textEl.className = 'text';
  textEl.textContent = message.text;

  const metaEl = document.createElement('div');
  metaEl.className = 'meta';
  const date = new Date(message.created_at);
  metaEl.textContent = date.toLocaleString();

  div.appendChild(textEl);
  div.appendChild(metaEl);

  return div;
}

// Append a message to the DOM
function appendMessage(message) {
  const el = createMessageElement(message);
  messageList.appendChild(el);
}

// Fetch historical messages on page load
async function fetchMessages() {
  try {
    const response = await fetch(`${API_BASE}/api/messages`);
    if (!response.ok) throw new Error('Failed to fetch messages');
    const messages = await response.json();
    for (const message of messages) {
      appendMessage(message);
    }
  } catch (err) {
    console.error('Error fetching messages:', err);
  }
}

// Connect to SSE stream for real-time updates
function connectSSE() {
  const eventSource = new EventSource(`${API_BASE}/api/stream`);

  eventSource.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      appendMessage(message);
    } catch (err) {
      console.error('Error parsing SSE message:', err);
    }
  };

  eventSource.onerror = (err) => {
    console.error('SSE connection error:', err);
    // EventSource will automatically attempt to reconnect
  };
}

// Handle form submission
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

    if (!response.ok) throw new Error('Failed to post message');

    // Clear the input after successful post
    messageInput.value = '';
    messageInput.focus();
  } catch (err) {
    console.error('Error posting message:', err);
  }
});

// Initialize
fetchMessages();
connectSSE();

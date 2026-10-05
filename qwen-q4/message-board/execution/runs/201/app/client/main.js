const messageList = document.getElementById('message-list');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');

// Fetch initial messages from the API
async function fetchMessages() {
  try {
    const response = await fetch('/api/messages');
    const messages = await response.json();
    messageList.innerHTML = '';
    messages.forEach((msg) => appendMessage(msg));
  } catch (err) {
    console.error('Failed to fetch messages:', err);
  }
}

// Append a single message to the DOM
function appendMessage(msg) {
  const div = document.createElement('div');
  div.className = 'message';

  const textSpan = document.createElement('span');
  textSpan.className = 'text';
  textSpan.textContent = msg.text;

  const timeSpan = document.createElement('span');
  timeSpan.className = 'timestamp';
  const date = new Date(msg.created_at);
  timeSpan.textContent = date.toLocaleString();

  div.appendChild(textSpan);
  div.appendChild(timeSpan);
  messageList.appendChild(div);

  // Scroll to bottom
  messageList.scrollTop = messageList.scrollHeight;
}

// Connect to SSE for real-time updates
function connectSSE() {
  const eventSource = new EventSource('/api/stream');

  eventSource.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    appendMessage(msg);
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
    const response = await fetch('/api/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      throw new Error('Failed to post message');
    }

    messageInput.value = '';
  } catch (err) {
    console.error('Failed to post message:', err);
  }
});

// Initialize
fetchMessages();
connectSSE();

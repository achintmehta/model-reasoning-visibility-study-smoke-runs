const messageList = document.getElementById('message-list');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');

// Track message IDs to avoid duplicates from SSE + initial fetch
const messageIds = new Set();

// Fetch initial messages from the server
async function loadMessages() {
  try {
    const response = await fetch('/api/messages');
    const messages = await response.json();

    for (const msg of messages) {
      if (!messageIds.has(msg.id)) {
        messageIds.add(msg.id);
        appendMessage(msg);
      }
    }

    // Scroll to bottom after loading
    messageList.scrollTop = messageList.scrollHeight;
  } catch (err) {
    console.error('Failed to load messages:', err);
  }
}

// Append a message to the DOM
function appendMessage(msg) {
  const messageEl = document.createElement('div');
  messageEl.className = 'message';

  const textEl = document.createElement('div');
  textEl.className = 'message-text';
  textEl.textContent = msg.text;

  const timeEl = document.createElement('div');
  timeEl.className = 'message-time';
  const date = new Date(msg.created_at);
  timeEl.textContent = date.toLocaleString();

  messageEl.appendChild(textEl);
  messageEl.appendChild(timeEl);
  messageList.appendChild(messageEl);

  // Scroll to bottom
  messageList.scrollTop = messageList.scrollHeight;
}

// Connect to SSE stream for real-time updates
function connectStream() {
  const eventSource = new EventSource('/api/stream');

  eventSource.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (!messageIds.has(msg.id)) {
        messageIds.add(msg.id);
        appendMessage(msg);
      }
    } catch (err) {
      console.error('Failed to parse SSE message:', err);
    }
  });

  eventSource.onerror = (err) => {
    console.error('SSE connection error:', err);
    eventSource.close();

    // Attempt to reconnect after a delay
    setTimeout(() => {
      console.log('Attempting to reconnect...');
      connectStream();
    }, 3000);
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
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text })
    });

    if (response.ok) {
      const msg = await response.json();
      messageIds.add(msg.id);
      appendMessage(msg);
      messageInput.value = '';
    } else {
      const error = await response.json();
      console.error('Failed to send message:', error.error);
    }
  } catch (err) {
    console.error('Failed to send message:', err);
  }
});

// Initialize
loadMessages();
connectStream();

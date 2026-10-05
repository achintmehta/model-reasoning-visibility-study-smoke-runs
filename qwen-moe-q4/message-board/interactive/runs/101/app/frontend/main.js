const messageList = document.getElementById('message-list');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');

// Format timestamp for display
function formatTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Create a message DOM element
function createMessageElement(message) {
  const div = document.createElement('div');
  div.className = 'message';
  div.innerHTML = `
    <p class="message-text">${escapeHtml(message.text)}</p>
    <span class="message-time">${formatTime(message.created_at)}</span>
  `;
  return div;
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Fetch and render historical messages
async function loadMessages() {
  try {
    const res = await fetch('/api/messages');
    const messages = await res.json();
    messageList.innerHTML = '';
    for (const msg of messages) {
      messageList.appendChild(createMessageElement(msg));
    }
  } catch (err) {
    console.error('Failed to load messages:', err);
  }
}

// Connect to SSE stream for real-time updates
function connectSSE() {
  const eventSource = new EventSource('/api/stream');

  eventSource.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const el = createMessageElement(message);
    messageList.appendChild(el);
    // Scroll to the bottom
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  });

  eventSource.onerror = (err) => {
    console.error('SSE connection error:', err);
    eventSource.close();
    // Reconnect after a delay
    setTimeout(connectSSE, 3000);
  };
}

// Handle form submission
messageForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;

  try {
    await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    messageInput.value = '';
  } catch (err) {
    console.error('Failed to post message:', err);
  }
});

// Initialize
loadMessages();
connectSSE();

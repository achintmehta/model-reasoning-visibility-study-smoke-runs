const API_BASE = window.location.origin;

const messageList = document.getElementById('message-list');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');

// Fetch historical messages on page load
async function loadMessages() {
  try {
    const response = await fetch(`${API_BASE}/api/messages`);
    if (!response.ok) throw new Error('Failed to fetch messages');
    const messages = await response.json();
    messages.forEach((msg) => appendMessage(msg));
  } catch (err) {
    console.error('Error loading messages:', err);
  }
}

// Append a message to the DOM
function appendMessage(msg) {
  const li = document.createElement('li');
  li.className = 'message-item';
  li.dataset.id = msg.id;

  const textDiv = document.createElement('div');
  textDiv.className = 'message-text';
  textDiv.textContent = msg.text;

  const timeSpan = document.createElement('span');
  timeSpan.className = 'message-time';
  timeSpan.textContent = new Date(msg.created_at).toLocaleString();

  li.appendChild(textDiv);
  li.appendChild(timeSpan);

  messageList.appendChild(li);

  // Scroll to bottom
  window.scrollTo(0, document.body.scrollHeight);
}

// Connect to SSE stream
function connectStream() {
  const eventSource = new EventSource(`${API_BASE}/api/stream`);

  eventSource.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    // Only append if not already in the DOM (to avoid duplicates on reconnect)
    const existing = messageList.querySelector(`[data-id="${msg.id}"]`);
    if (!existing) {
      appendMessage(msg);
    }
  });

  eventSource.onerror = (err) => {
    console.error('SSE connection error:', err);
    eventSource.close();
    // Reconnect after a delay
    setTimeout(connectStream, 3000);
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
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) throw new Error('Failed to post message');

    // Clear input
    messageInput.value = '';
  } catch (err) {
    console.error('Error posting message:', err);
  }
});

// Initialize
loadMessages();
connectStream();

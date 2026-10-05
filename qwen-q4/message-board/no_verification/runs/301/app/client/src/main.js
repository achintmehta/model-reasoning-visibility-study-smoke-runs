// DOM elements
const messageList = document.getElementById('message-list');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const submitBtn = document.getElementById('submit-btn');
const statusEl = document.getElementById('status');

// State
let sse = null;

/**
 * Format a date into a readable string
 */
function formatTime(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * Create a message element from message data
 */
function createMessageElement(message) {
  const li = document.createElement('li');
  li.className = 'message';

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `#${message.id} · ${formatTime(message.created_at)}`;

  const text = document.createElement('div');
  text.className = 'text';
  text.textContent = message.text;

  li.appendChild(meta);
  li.appendChild(text);

  return li;
}

/**
 * Add a message to the DOM
 */
function addMessage(message) {
  // Remove empty placeholder
  messageList.classList.remove('empty');

  const el = createMessageElement(message);
  messageList.appendChild(el);

  // Scroll to bottom
  messageList.scrollTop = messageList.scrollHeight;
}

/**
 * Render initial messages
 */
function renderMessages(messages) {
  messageList.innerHTML = '';
  if (messages.length === 0) {
    messageList.classList.add('empty');
    return;
  }
  messages.forEach(addMessage);
}

/**
 * Update connection status display
 */
function setStatus(connected) {
  if (connected) {
    statusEl.textContent = '● Live';
    statusEl.className = 'status connected';
  } else {
    statusEl.textContent = '○ Disconnected';
    statusEl.className = 'status disconnected';
  }
}

/**
 * Fetch initial message history from the API
 */
async function fetchMessages() {
  try {
    const response = await fetch('/api/messages');
    if (!response.ok) throw new Error('Failed to fetch messages');
    const messages = await response.json();
    renderMessages(messages);
  } catch (err) {
    console.error('Error fetching messages:', err);
  }
}

/**
 * Connect to the SSE stream for real-time updates
 */
function connectSSE() {
  // Close existing connection if any
  if (sse) {
    sse.close();
  }

  sse = new EventSource('/api/stream');

  sse.onopen = () => {
    console.log('SSE connected');
    setStatus(true);
  };

  sse.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      addMessage(message);
    } catch (err) {
      console.error('Failed to parse SSE message:', err);
    }
  };

  sse.onerror = (err) => {
    console.error('SSE error:', err);
    setStatus(false);
    // EventSource will automatically try to reconnect
  };
}

/**
 * Post a new message
 */
async function postMessage(text) {
  try {
    submitBtn.disabled = true;

    const response = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Failed to post message');
    }

    const message = await response.json();
    addMessage(message);
    messageInput.value = '';
    messageInput.focus();
  } catch (err) {
    console.error('Error posting message:', err);
    alert(err.message || 'Failed to send message. Please try again.');
  } finally {
    submitBtn.disabled = false;
  }
}

// Form submission handler
messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;
  postMessage(text);
});

// Initialize the app
async function init() {
  // Fetch initial messages
  await fetchMessages();

  // Connect to SSE for real-time updates
  connectSSE();
}

init();

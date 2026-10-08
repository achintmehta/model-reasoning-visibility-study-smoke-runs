// DOM elements
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const messageList = document.getElementById('message-list');
const sendBtn = document.getElementById('send-btn');

let eventSource = null;

/**
 * Format a date string into a readable time format.
 */
function formatTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
    ' · ' + date.toLocaleDateString();
}

/**
 * Escape HTML to prevent XSS.
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Create a message DOM element from a message object.
 */
function createMessageElement(message) {
  const el = document.createElement('div');
  el.className = 'message';
  el.innerHTML =
    '<div class="message-text">' + escapeHtml(message.text) + '</div>' +
    '<div class="message-time">' + formatTime(message.created_at) + '</div>';
  return el;
}

/**
 * Append a message to the message list and scroll into view.
 */
function appendMessage(message) {
  const el = createMessageElement(message);
  messageList.appendChild(el);
  // Scroll to bottom smoothly
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

/**
 * Fetch initial messages from the API and render them.
 */
async function fetchMessages() {
  try {
    const response = await fetch('/api/messages');
    if (!response.ok) {
      throw new Error('Failed to fetch messages');
    }
    const messages = await response.json();
    messageList.innerHTML = '';
    messages.forEach(appendMessage);
  } catch (err) {
    console.error('Error fetching messages:', err);
  }
}

/**
 * Connect to the SSE stream for real-time updates.
 */
function connectSSE() {
  // Close existing connection if any
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource('/api/stream');

  eventSource.onmessage = function (event) {
    try {
      const message = JSON.parse(event.data);
      appendMessage(message);
    } catch (err) {
      console.error('Error parsing SSE message:', err);
    }
  };

  eventSource.onerror = function () {
    console.warn('SSE connection lost. Reconnecting...');
    // EventSource will automatically attempt to reconnect
  };
}

/**
 * Handle form submission: POST a new message.
 */
async function handleSubmit(e) {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;

  // Disable input while sending
  messageInput.disabled = true;
  sendBtn.disabled = true;

  try {
    const response = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      throw new Error('Failed to post message');
    }

    // Clear input (the message will appear via SSE broadcast)
    messageInput.value = '';
  } catch (err) {
    console.error('Error posting message:', err);
    // Re-enable even on error so user can retry
    messageInput.disabled = false;
    sendBtn.disabled = false;
  }

  messageInput.disabled = false;
  sendBtn.disabled = false;
  messageInput.focus();
}

// Initialize the app
messageForm.addEventListener('submit', handleSubmit);
fetchMessages();
connectSSE();

const messagesDiv = document.getElementById('messages');
const form = document.getElementById('messageForm');
const input = document.getElementById('messageInput');

let messageIds = new Set();

function formatTime(dateString) {
  const date = new Date(dateString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderMessage(message) {
  if (messageIds.has(message.id)) return;
  messageIds.add(message.id);
  
  const messageEl = document.createElement('div');
  messageEl.className = 'message';
  messageEl.id = `message-${message.id}`;
  messageEl.innerHTML = `
    <div class="message-text">${escapeHtml(message.text)}</div>
    <div class="message-time">${formatTime(message.created_at)}</div>
  `;
  
  // Remove empty state if present
  const emptyEl = messagesDiv.querySelector('.empty');
  if (emptyEl) emptyEl.remove();
  
  messagesDiv.appendChild(messageEl);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function loadMessages() {
  try {
    const response = await fetch('/api/messages');
    const messages = await response.json();
    messagesDiv.innerHTML = '';
    messageIds.clear();
    if (messages.length === 0) {
      messagesDiv.innerHTML = '<div class="empty">No messages yet. Be the first to post!</div>';
    } else {
      messages.forEach(renderMessage);
    }
  } catch (err) {
    console.error('Failed to load messages:', err);
    messagesDiv.innerHTML = '<div class="empty">Failed to load messages</div>';
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  
  try {
    const response = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    
    if (response.ok) {
      input.value = '';
    }
  } catch (err) {
    console.error('Failed to send message:', err);
  }
});

// Connect to SSE
const eventSource = new EventSource('/api/stream');
eventSource.onmessage = (event) => {
  try {
    const message = JSON.parse(event.data);
    renderMessage(message);
  } catch (err) {
    console.error('Failed to parse SSE message:', err);
  }
};

eventSource.onerror = (err) => {
  console.error('SSE error:', err);
};

// Load initial messages
loadMessages();

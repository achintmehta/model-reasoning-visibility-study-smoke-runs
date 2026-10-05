const messagesList = document.getElementById('messages');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');

const API_BASE = 'http://localhost:3000/api';

function appendMessage(msg) {
  const li = document.createElement('li');
  li.className = 'message';
  const date = new Date(msg.created_at).toLocaleString();
  li.innerHTML = `<span class="time">${date}</span><div>${escapeHtml(msg.text)}</div>`;
  messagesList.appendChild(li);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function fetchMessages() {
  try {
    const response = await fetch(`${API_BASE}/messages`);
    const messages = await response.json();
    messages.forEach(appendMessage);
  } catch (err) {
    console.error('Error fetching messages:', err);
  }
}

messageForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = messageInput.value;
  try {
    const response = await fetch(`${API_BASE}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (response.ok) {
      messageInput.value = '';
    }
  } catch (err) {
    console.error('Error posting message:', err);
  }
});

function setupSSE() {
  const eventSource = new EventSource(`${API_BASE}/stream`);
  eventSource.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    appendMessage(msg);
  };
  eventSource.onerror = (err) => {
    console.error('SSE error:', err);
    eventSource.close();
    // Attempt to reconnect after a delay
    setTimeout(setupSSE, 5000);
  };
}

fetchMessages();
setupSSE();

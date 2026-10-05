// frontend/src/main.js

const messagesDiv = document.getElementById('messages');
const form = document.getElementById('postForm');
const input = document.getElementById('messageInput');
const API_BASE = 'http://localhost:3000';

async function fetchHistory() {
  const res = await fetch(`${API_BASE}/api/messages`);
  if (!res.ok) {
    console.error('Failed to load history');
    return;
  }
  const msgs = await res.json();
  for (const msg of msgs) {
    appendMessage(msg);
  }
}

function appendMessage(msg) {
  const div = document.createElement('div');
  div.className = 'message';
  div.textContent = msg.text;
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function setupSSE() {
  const evtSource = new EventSource(`${API_BASE}/api/stream`);
  evtSource.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    appendMessage(msg);
  };
  evtSource.onerror = (err) => {
    console.error('EventSource failed:', err);
  };
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  await fetch(`${API_BASE}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  input.value = '';
});

async function init() {
  await fetchHistory();
  setupSSE();
}

init();

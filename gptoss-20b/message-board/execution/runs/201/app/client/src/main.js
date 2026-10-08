// Simple front-end logic for the realtime board
const BASE_URL = 'http://localhost:3000';
const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const formEl = document.getElementById('form');

// Utility to append a message element
function appendMessage(msg) {
  const div = document.createElement('div');
  div.textContent = `[${new Date(msg.created_at).toLocaleTimeString()}] ${msg.text}`;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// Load history
async function loadHistory() {
  try {
    const res = await fetch(`${BASE_URL}/api/messages`);
    const data = await res.json();
    data.forEach(appendMessage);
  } catch (err) {
    console.error('Failed to load history', err);
  }
}

// Submit new message
async function postMessage(text) {
  const res = await fetch(`${BASE_URL}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert('Error: ' + (data.error || 'Unknown'));
    return;
  }
  // message will arrive via SSE as well; we can rely on that
}

// SSE listener
function initSSE() {
  const es = new EventSource(`${BASE_URL}/api/stream`);
  es.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      appendMessage(msg);
    } catch (err) {
      console.error('Failed to parse SSE data', err);
    }
  };
  es.onerror = (err) => {
    console.error('SSE error', err);
  };
}

formEl.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;
  postMessage(text);
  inputEl.value = '';
});

// Initialisation
loadHistory();
initSSE();

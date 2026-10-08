const messagesDiv = document.getElementById('messages');
const form = document.getElementById('message-form');
const textarea = document.getElementById('text');

// Fetch initial messages
async function loadMessages() {
  try {
    const res = await fetch('/api/messages');
    const data = await res.json();
    data.forEach(addMessageElement);
  } catch (e) {
    console.error('Failed to load messages', e);
  }
}

// Append message
function addMessageElement(msg) {
  const el = document.createElement('div');
  el.className = 'message';
  const time = new Date(msg.created_at).toLocaleTimeString();
  el.textContent = `[${time}] ${msg.text}`;
  messagesDiv.appendChild(el);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// SSE listener
function initSSE() {
  const evtSource = new EventSource('/api/stream');
  evtSource.onmessage = function (e) {
    const msg = JSON.parse(e.data);
    addMessageElement(msg);
  };
  evtSource.onerror = function (e) {
    console.error('SSE error', e);
  };
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = textarea.value.trim();
  if (!text) return;
  try {
    const res = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error('Network response was not ok');
    textarea.value = '';
  } catch (err) {
    console.error('Failed to send message', err);
  }
});

// Initialize
loadMessages();
initSSE();

const messagesList = document.getElementById('messages');
const form = document.getElementById('messageForm');
const input = document.getElementById('messageInput');

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString();
}

function renderMessage(msg, prepend = false) {
  const li = document.createElement('li');
  li.dataset.id = msg.id;
  li.innerHTML = `<strong>${escapeHtml(msg.text)}</strong><small>${formatDate(msg.created_at)}</small>`;
  if (prepend) {
    messagesList.insertBefore(li, messagesList.firstChild);
  } else {
    messagesList.appendChild(li);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function fetchHistory() {
  try {
    const res = await fetch('/api/messages');
    const msgs = await res.json();
    messagesList.innerHTML = '';
    msgs.forEach(m => renderMessage(m));
  } catch (e) {
    console.error('Failed to fetch history', e);
  }
}

function connectSSE() {
  const es = new EventSource('/api/stream');
  es.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === 'message') {
        renderMessage(payload.data);
      }
    } catch (e) {
      console.error(e);
    }
  };
  es.onerror = (e) => {
    console.error('SSE error', e);
  };
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  try {
    await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    input.value = '';
  } catch (err) {
    console.error('Failed to send', err);
  }
});

fetchHistory();
connectSSE();

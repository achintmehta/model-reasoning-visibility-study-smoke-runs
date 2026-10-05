const messagesEl = document.getElementById('messages');
const form = document.getElementById('form');
const input = document.getElementById('text');

function renderMessage(msg) {
  const li = document.createElement('li');
  li.dataset.id = msg.id;
  const time = new Date(msg.created_at).toLocaleString();
  li.innerHTML = `<span>${escapeHtml(msg.text)}</span><time>${time}</time>`;
  messagesEl.appendChild(li);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

async function loadHistory() {
  const res = await fetch('/api/messages');
  const msgs = await res.json();
  messagesEl.innerHTML = '';
  msgs.forEach(renderMessage);
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
  } catch {}
});

const source = new EventSource('/api/stream');
source.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (!document.querySelector(`li[data-id="${msg.id}"]`)) {
    renderMessage(msg);
  }
};

loadHistory();

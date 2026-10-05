// Helper to format time as human readable
function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString();
}

const messagesEl = document.getElementById('messages');
const form = document.getElementById('form');
const textInput = document.getElementById('text');

async function loadHistory() {
  try {
    const res = await fetch('/api/messages');
    const msgs = await res.json();
    msgs.forEach(renderMessage);
    // Scroll to bottom
    messagesEl.scrollTop = messagesEl.scrollHeight;
  } catch (err) {
    console.error('Error loading history', err);
  }
}

function renderMessage(msg) {
  const div = document.createElement('div');
  div.className = 'message';
  div.textContent = `${msg.text} (${formatTime(msg.created_at)})`;
  messagesEl.appendChild(div);
}

function setupSSE() {
  const evtSource = new EventSource('/api/stream');
  evtSource.onmessage = function(e) {
    const msg = JSON.parse(e.data);
    renderMessage(msg);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  };
  evtSource.onerror = function(err) {
    console.error('SSE error', err);
    setTimeout(setupSSE, 5000); // retry after delay
  };
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = textInput.value.trim();
  if (!text) return;
  try {
    const res = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    if (!res.ok) throw new Error('Failed to post');
    textInput.value = '';
  } catch (err) {
    console.error('Error posting message', err);
  }
});

// init
loadHistory();
setupSSE();

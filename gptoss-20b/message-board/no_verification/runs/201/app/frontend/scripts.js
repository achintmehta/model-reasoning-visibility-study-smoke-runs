// Client-side script for realtime board
const messageContainer = document.getElementById('messages');
const form = document.getElementById('postForm');
const input = document.getElementById('msgInput');

function addMessage(msg) {
  const div = document.createElement('div');
  div.className = 'message';
  const time = new Date(msg.created_at).toLocaleTimeString();
  div.innerHTML = `<strong>${msg.text}</strong> <span>(${time})</span>`;
  messageContainer.appendChild(div);
  messageContainer.scrollTop = messageContainer.scrollHeight;
}

// Fetch initial messages
async function loadMessages() {
  try {
    const res = await fetch('/api/messages');
    const msgs = await res.json();
    msgs.forEach(addMessage);
  } catch (err) {
    console.error('Error loading messages', err);
  }
}

// Handle SSE
function listen() {
  const evtSource = new EventSource('/api/stream');
  evtSource.onmessage = function (e) {
    const msg = JSON.parse(e.data);
    addMessage(msg);
  };
  evtSource.onerror = function () {
    console.error('SSE connection error');
    evtSource.close();
    // try reconnect after a delay
    setTimeout(listen, 3000);
  };
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  try {
    const res = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (res.ok) {
      input.value = '';
    }
  } catch (err) {
    console.error('Error posting message', err);
  }
});

// init
loadMessages();
listen();

import './style.css';

const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const messageList = document.getElementById('message-list');

// Fetch initial messages from the server
async function loadMessages() {
  try {
    const res = await fetch('/api/messages');
    const messages = await res.json();
    messages.forEach((msg) => appendMessage(msg));
  } catch (err) {
    console.error('Failed to load messages:', err);
  }
}

// Append a single message to the DOM
function appendMessage(msg) {
  const div = document.createElement('div');
  div.classList.add('message-item');
  div.dataset.id = msg.id;

  const textSpan = document.createElement('span');
  textSpan.classList.add('message-text');
  textSpan.textContent = msg.text;

  const timeSpan = document.createElement('small');
  timeSpan.classList.add('message-time');
  timeSpan.textContent = new Date(msg.created_at).toLocaleTimeString();

  div.appendChild(textSpan);
  div.appendChild(timeSpan);
  messageList.appendChild(div);

  // Scroll to bottom
  messageList.scrollTop = messageList.scrollHeight;
}

// Post a new message via HTTP POST
async function postMessage(text) {
  try {
    const res = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error('Failed to post message');
  } catch (err) {
    console.error('Failed to post message:', err);
  }
}

// Connect to SSE stream for real-time updates
function connectStream() {
  const eventSource = new EventSource('/api/stream');

  eventSource.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(event.data);
      appendMessage(msg);
    } catch (err) {
      console.error('Failed to parse SSE message:', err);
    }
  });

  eventSource.onerror = () => {
    console.warn('SSE connection lost. Reconnecting...');
    eventSource.close();
    setTimeout(connectStream, 3000);
  };
}

// Form submission handler
messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;

  postMessage(text);
  messageInput.value = '';
});

// Initialize
loadMessages();
connectStream();

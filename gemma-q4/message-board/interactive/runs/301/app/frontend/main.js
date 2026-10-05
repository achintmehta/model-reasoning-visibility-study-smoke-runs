const API_BASE = 'http://localhost:3000/api';
const messagesList = document.getElementById('messages');
const messageForm = document.getElementById('form');
const messageInput = document.getElementById('message-input');

function appendMessage(message) {
  const li = document.createElement('li');
  li.className = 'message';
  
  const time = new Date(message.created_at).toLocaleTimeString();
  
  li.innerHTML = `
    <span class="time">${time}</span>
    <div class="text">${escapeHtml(message.text)}</div>
  `;
  messagesList.appendChild(li);
  window.scrollTo(0, document.body.scrollHeight);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function loadMessages() {
  try {
    const response = await fetch(`${API_BASE}/messages`);
    const messages = await response.json();
    messages.forEach(appendMessage);
  } catch (error) {
    console.error('Error loading messages:', error);
  }
}

function setupSSE() {
  const eventSource = new EventSource(`${API_BASE}/stream`);

  eventSource.onmessage = (event) => {
    const message = JSON.parse(event.data);
    appendMessage(message);
  };

  eventSource.onerror = (error) => {
    console.error('SSE error:', error);
  };
}

messageForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;

  try {
    const response = await fetch(`${API_BASE}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      throw new Error('Failed to send message');
    }

    messageInput.value = '';
  } catch (error) {
    console.error('Error sending message:', error);
    alert('Error sending message. Please try again.');
  }
});

// Initialize
loadMessages();
setupSSE();

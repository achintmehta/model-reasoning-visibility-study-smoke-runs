const API_BASE = 'http://localhost:3000/api';
const messagesContainer = document.getElementById('messages');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');

function appendMessage(msg) {
  const div = document.createElement('div');
  div.className = 'message';
  
  const time = new Date(msg.created_at).toLocaleTimeString();
  div.innerHTML = `<span>${msg.text}</span><span class="message-time">${time}</span>`;
  
  messagesContainer.appendChild(div);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

async function loadMessages() {
  try {
    const response = await fetch(`${API_BASE}/messages`);
    const messages = await response.json();
    messages.forEach(appendMessage);
  } catch (err) {
    console.error('Error loading messages:', err);
  }
}

function setupSSE() {
  const eventSource = new EventSource(`${API_BASE}/stream`);
  
  eventSource.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    appendMessage(msg);
  };

  eventSource.onerror = (err) => {
    console.error('SSE Error:', err);
  };
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
    console.error('Error sending message:', err);
  }
});

loadMessages();
setupSSE();

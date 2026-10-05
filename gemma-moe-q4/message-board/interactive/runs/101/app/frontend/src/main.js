const messagesList = document.getElementById('messages-list');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');

const API_BASE = 'http://localhost:3000/api';

async function fetchMessages() {
  try {
    const response = await fetch(`${API_BASE}/messages`);
    const messages = await response.json();
    messages.forEach(addMessageToDOM);
  } catch (error) {
    console.error('Error fetching messages:', error);
  }
}

function addMessageToDOM(message) {
  const li = document.createElement('li');
  const time = new Date(message.created_at).toLocaleTimeString();
  li.innerHTML = `
    <span class="message-text">${escapeHTML(message.text)}</span>
    <span class="message-time">${time}</span>
  `;
  messagesList.appendChild(li);
  // Scroll to bottom
  const container = document.getElementById('messages-container');
  container.scrollTop = container.scrollHeight;
}

function escapeHTML(str) {
  const p = document.createElement('p');
  p.textContent = str;
  return p.innerHTML;
}

function setupSSE() {
  const eventSource = new EventSource('http://localhost:3000/api/stream');
  
  eventSource.onmessage = (event) => {
    const message = JSON.parse(event.data);
    addMessageToDOM(message);
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

    if (response.ok) {
      messageInput.value = '';
    } else {
      console.error('Failed to send message');
    }
  } catch (error) {
    console.error('Error sending message:', error);
  }
});

// Initial load
fetchMessages();
// Setup real-time updates
setupSSE();

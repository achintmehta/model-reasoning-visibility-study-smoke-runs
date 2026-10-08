const messageContainer = document.getElementById('message-container');
const messageForm = document.getElementById('form-container');
const messageInput = document.getElementById('message-input');

const API_BASE = 'http://localhost:3001/api';

function appendMessage(message) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message';
  
  const textSpan = document.createElement('span');
  textSpan.className = 'message-text';
  textSpan.textContent = message.text;
  
  const timeSpan = document.createElement('span');
  timeSpan.className = 'message-time';
  timeSpan.textContent = new Date(message.created_at).toLocaleString();
  
  messageDiv.appendChild(textSpan);
  messageDiv.appendChild(timeSpan);
  messageContainer.appendChild(messageDiv);
  
  // Scroll to bottom
  messageContainer.scrollTop = messageContainer.scrollHeight;
}

async function fetchMessages() {
  try {
    const response = await fetch(`${API_BASE}/messages`);
    const messages = await response.json();
    messages.forEach(appendMessage);
  } catch (err) {
    console.error('Error fetching messages:', err);
  }
}

async function postMessage(text) {
  try {
    const response = await fetch(`${API_BASE}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) {
      throw new Error('Failed to post message');
    }
  } catch (err) {
    console.error('Error posting message:', err);
  }
}

function setupSSE() {
  const eventSource = new EventSource(`${API_BASE}/stream`);
  
  eventSource.onmessage = (event) => {
    const newMessage = JSON.parse(event.data);
    appendMessage(newMessage);
  };

  eventSource.onerror = (err) => {
    console.error('SSE error:', err);
    // EventSource will automatically attempt to reconnect.
  };
}

messageForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (text) {
    await postMessage(text);
    messageInput.value = '';
  }
});

// Initial load
fetchMessages();
// Setup real-time updates
setupSSE();

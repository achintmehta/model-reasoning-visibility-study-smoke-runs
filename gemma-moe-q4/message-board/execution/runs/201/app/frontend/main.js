const messageList = document.getElementById('messages');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');

const API_BASE = 'http://localhost:3001/api';

async function fetchMessages() {
  try {
    const response = await fetch(`${API_BASE}/messages`);
    const messages = await response.json();
    messageList.innerHTML = '';
    // The API returns messages in DESC order, but we want to display them in ASC order for the list
    // Or just append them. Let's reverse them for chronological order if they are DESC.
    messages.reverse().forEach(appendMessage);
  } catch (err) {
    console.error('Error fetching messages:', err);
  }
}

function appendMessage(message) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message';
  
  const textSpan = document.createElement('span');
  textSpan.className = 'text';
  textSpan.textContent = message.text;

  const timeSpan = document.createElement('span');
  timeSpan.className = 'time';
  timeSpan.textContent = new Date(message.created_at).toLocaleString();

  messageDiv.appendChild(textSpan);
  messageDiv.appendChild(timeSpan);
  messageList.appendChild(messageDiv);
  
  // Scroll to bottom
  messageList.scrollTop = messageList.scrollHeight;
}

messageForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = messageInput.value;
  if (!text) return;

  messageInput.value = '';

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
    alert('Failed to send message');
  }
});

function setupSSE() {
  const eventSource = new EventSource('http://localhost:3001/api/stream');

  eventSource.onmessage = (event) => {
    const newMessage = JSON.parse(event.data);
    appendMessage(newMessage);
  };

  eventSource.onerror = (err) => {
    console.error('SSE error:', err);
    // The browser will automatically attempt to reconnect.
  };
}

// Initialize
fetchMessages().then(setupSSE);

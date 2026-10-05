const messagesContainer = document.getElementById('messages-container');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');

const API_BASE = 'http://localhost:3001/api';

function appendMessage(message) {
  const messageElement = document.createElement('div');
  messageElement.classList.add('message');
  // For simplicity, we'll just treat all messages as "not mine" for now
  // since we don't have authentication.
  messageElement.textContent = message.text;
  messagesContainer.appendChild(messageElement);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

async function fetchMessages() {
  try {
    const response = await fetch(`${API_BASE}/messages`);
    const messages = await response.json();
    messages.forEach(appendMessage);
  } catch (error) {
    console.error('Error fetching messages:', error);
  }
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
    
    // We don't need to append the message here because the SSE will pick it up.
    // However, to avoid delay and potential issues with SSE, we could append it here.
    // But the goal is to show SSE working.
  } catch (error) {
    console.error('Error posting message:', error);
  }
});

function setupSSE() {
  const eventSource = new EventSource('http://localhost:3001/api/stream');

  eventSource.onmessage = (event) => {
    const newMessage = JSON.parse(event.data);
    appendMessage(newMessage);
  };

  eventSource.onerror = (error) => {
    console.error('SSE error:', error);
  };
}

async function init() {
  await fetchMessages();
  setupSSE();
}

init();

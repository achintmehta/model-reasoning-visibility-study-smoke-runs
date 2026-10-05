const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const messageList = document.getElementById('message-list');

// --- DOM Helpers ---

function createMessageElement(message) {
  const div = document.createElement('div');
  div.className = 'message';

  const textSpan = document.createElement('div');
  textSpan.className = 'text';
  textSpan.textContent = message.text;

  const timeSpan = document.createElement('div');
  timeSpan.className = 'time';
  const date = new Date(message.created_at);
  timeSpan.textContent = date.toLocaleString();

  div.appendChild(textSpan);
  div.appendChild(timeSpan);

  return div;
}

// --- Fetch Historical Messages ---

async function fetchMessages() {
  try {
    const response = await fetch('/api/messages');
    if (!response.ok) throw new Error('Failed to fetch messages');
    const messages = await response.json();

    messageList.innerHTML = '';
    for (const msg of messages) {
      messageList.appendChild(createMessageElement(msg));
    }
  } catch (err) {
    console.error('Error fetching messages:', err);
  }
}

// --- Post a New Message ---

messageForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const text = messageInput.value.trim();
  if (!text) return;

  try {
    const response = await fetch('/api/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) throw new Error('Failed to post message');

    // Clear input after successful post (the SSE event will add it to the list)
    messageInput.value = '';
  } catch (err) {
    console.error('Error posting message:', err);
  }
});

// --- Connect to SSE Stream ---

function connectSSE() {
  const eventSource = new EventSource('/api/stream');

  eventSource.onmessage = (event) => {
    const message = JSON.parse(event.data);
    messageList.appendChild(createMessageElement(message));

    // Scroll to bottom on new message
    window.scrollTo({
      top: document.body.scrollHeight,
      behavior: 'smooth',
    });
  };

  eventSource.onerror = (err) => {
    console.error('SSE connection error:', err);
    // EventSource will automatically attempt to reconnect
  };
}

// --- Initialize ---

fetchMessages();
connectSSE();

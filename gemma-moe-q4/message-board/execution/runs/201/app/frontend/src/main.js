import './style.css'

const messagesList = document.getElementById('messages-list');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');

const API_BASE = 'http://localhost:3001/api';
const SSE_URL = 'http://localhost:3001/api/stream';

function appendMessage(message) {
  const li = document.createElement('li');
  const date = new Date(message.created_at).toLocaleString();
  
  li.innerHTML = `
    <span class="message-text">${escapeHtml(message.text)}</span>
    <span class="message-date">${date}</span>
  `;
  
  messagesList.appendChild(li);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function fetchMessages() {
  try {
    const response = await fetch(`${API_BASE}/messages`);
    const messages = await response.json();
    
    // Clear list first
    messagesList.innerHTML = '';
    
    // Since we want them in order in the UI, 
    // and we fetched them DESC, let's append them such that 
    // the latest is at the top. 
    // Our appendMessage puts it at the top (insertBefore(li, messagesList.firstChild)).
    // If we fetch DESC, the first element is the latest.
    // If we want latest at top, and we iterate through DESC:
    // first element (latest) -> append to top.
    // second element (older) -> append to top? No, that would put it above the latest.
    // Actually, if they are DESC, and we want latest at top:
    // messages[0] is latest.
    // messages[1] is older.
    // If we use appendMessage(messages[0]), it goes to top.
    // Then appendMessage(messages[1]), it goes to top, so it's now above messages[0].
    // That's wrong.
    
    // Let's just iterate through them and append them such that latest is at top.
    // If they are DESC: [latest, older, oldest]
    // We want:
    // [latest]
    // [older]
    // [oldest]
    // So we should append them to the end of the list in the order they come from DESC.
    // Or reverse the array and use appendChild.
    
    messages.reverse().forEach(msg => {
      const li = document.createElement('li');
      const date = new Date(msg.created_at).toLocaleString();
      li.innerHTML = `
        <span class="message-text">${escapeHtml(msg.text)}</span>
        <span class="message-date">${date}</span>
      `;
      messagesList.appendChild(li);
    });

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

function initSSE() {
  const eventSource = new EventSource(SSE_URL);

  eventSource.onmessage = (event) => {
    const newMessage = JSON.parse(event.data);
    appendMessage(newMessage);
  };

  eventSource.onerror = (err) => {
    console.error('SSE Error:', err);
    eventSource.close();
  };
}

messageForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;

  messageInput.value = '';
  await postMessage(text);
});

// Initial load
fetchMessages();
initSSE();

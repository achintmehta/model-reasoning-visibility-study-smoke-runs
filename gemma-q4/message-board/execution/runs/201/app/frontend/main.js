const API_BASE = 'http://localhost:3001/api';
const messagesList = document.getElementById('messages');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');

function addMessageToDOM(message) {
    const li = document.createElement('li');
    const time = new Date(message.created_at).toLocaleTimeString();
    li.innerHTML = `
        <span class="message-text">${escapeHtml(message.text)}</span>
        <span class="message-time">${time}</span>
    `;
    messagesList.appendChild(li);
    messagesList.scrollTop = messagesList.scrollHeight;
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
        messages.forEach(addMessageToDOM);
    } catch (error) {
        console.error('Error fetching messages:', error);
    }
}

function setupSSE() {
    const eventSource = new EventSource(`${API_BASE}/stream`);
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
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
        if (!response.ok) {
            throw new Error('Failed to send message');
        }
        messageInput.value = '';
    } catch (error) {
        console.error('Error posting message:', error);
        alert('Failed to send message');
    }
});

// Initial load
fetchMessages();
setupSSE();

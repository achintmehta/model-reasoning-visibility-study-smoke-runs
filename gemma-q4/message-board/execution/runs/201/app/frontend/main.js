const API_BASE = 'http://localhost:3000/api';
const messagesContainer = document.getElementById('messages-container');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');

function renderMessage(msg) {
    const div = document.createElement('div');
    div.className = 'message';
    
    const date = new Date(msg.created_at);
    const timestamp = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    div.innerHTML = `
        <span class="timestamp">${timestamp}</span>
        <div class="text">${msg.text}</div>
    `;
    
    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

async function loadMessages() {
    try {
        const response = await fetch(`${API_BASE}/messages`);
        const messages = await response.json();
        messages.forEach(renderMessage);
    } catch (error) {
        console.error('Error loading messages:', error);
    }
}

function setupSSE() {
    const eventSource = new EventSource(`${API_BASE}/stream`);
    
    eventSource.onmessage = (event) => {
        const message = JSON.parse(event.data);
        renderMessage(message);
    };
    
    eventSource.onerror = (error) => {
        console.error('SSE error:', error);
        // EventSource automatically attempts to reconnect
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
            body: JSON.stringify({ text }),
        });

        if (!response.ok) {
            throw new Error('Failed to send message');
        }

        messageInput.value = '';
    } catch (error) {
        console.error('Error sending message:', error);
        alert('Failed to send message. Please try again.');
    }
});

// Initialize
loadMessages();
setupSSE();

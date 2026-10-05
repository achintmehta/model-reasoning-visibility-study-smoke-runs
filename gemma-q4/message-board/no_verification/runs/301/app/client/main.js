const API_BASE = 'http://localhost:3000/api';
const messagesDiv = document.getElementById('messages');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');

function appendMessage(msg) {
    const messageEl = document.createElement('div');
    messageEl.className = 'message';
    
    const text = document.createElement('span');
    text.textContent = msg.text;
    
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = new Date(msg.created_at).toLocaleTimeString();
    
    messageEl.appendChild(text);
    messageEl.appendChild(time);
    messagesDiv.appendChild(messageEl);
    
    // Scroll to bottom
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
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
        const msg = JSON.parse(event.data);
        appendMessage(msg);
    };
    
    eventSource.onerror = (error) => {
        console.error('SSE error:', error);
        eventSource.close();
        // Try to reconnect after a delay
        setTimeout(setupSSE, 5000);
    };
}

messageForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = messageInput.value;
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
        alert('Error sending message');
    }
});

// Initial load
loadMessages();
setupSSE();

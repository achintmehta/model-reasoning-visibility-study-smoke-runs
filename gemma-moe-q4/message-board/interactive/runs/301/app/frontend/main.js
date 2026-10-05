const messageList = document.getElementById('message-list');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');

const API_BASE = '';

function appendMessage(message) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message');
    
    const timestamp = new Date(message.created_at).toLocaleTimeString();
    
    messageElement.innerHTML = `
        <span class="text">${message.text}</span>
        <span class="timestamp">${timestamp}</span>
    `;
    
    messageList.appendChild(messageElement);
    messageList.scrollTop = messageList.scrollHeight;
}

async function fetchMessages() {
    try {
        const response = await fetch(`${API_BASE}/api/messages`);
        const messages = await response.json();
        messages.forEach(appendMessage);
    } catch (error) {
        console.error('Error fetching messages:', error);
    }
}

function setupSSE() {
    const eventSource = new EventSource(`${API_BASE}/api/stream`);

    eventSource.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            appendMessage(message);
        } catch (e) {
            console.error('Error parsing SSE message:', e);
        }
    };

    eventSource.onerror = (error) => {
        console.error('SSE error:', error);
        // Don't close it, let it try to reconnect
    };
}

messageForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text) return;

    try {
        const response = await fetch(`${API_BASE}/api/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ text }),
        });

        if (response.ok) {
            messageInput.value = '';
        } else {
            console.error('Error posting message:', response.statusText);
        }
    } catch (error) {
        console.error('Error posting message:', error);
    }
});

// Initial load
fetchMessages();
setupSSE();

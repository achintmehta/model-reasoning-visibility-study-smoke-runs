const API_BASE = 'http://localhost:3001/api';

export function createApp() {
    const messageList = document.getElementById('message-list');
    const messageForm = document.getElementById('message-form');
    const messageInput = document.getElementById('message-input');

    if (!messageList || !messageForm || !messageInput) {
        console.error('Required DOM elements not found');
        return;
    }

    function appendMessage(message) {
        const div = document.createElement('div');
        div.className = 'message';
        
        const timestamp = document.createElement('div');
        timestamp.className = 'timestamp';
        // PGLite returns ISO strings for timestamps
        timestamp.textContent = new Date(message.created_at).toLocaleString();
        
        const text = document.createElement('div');
        text.textContent = message.text;
        
        div.appendChild(timestamp);
        div.appendChild(text);
        messageList.appendChild(div);
        
        // Scroll to bottom
        messageList.scrollTop = messageList.scrollHeight;
    }

    // Initial fetch
    async function fetchMessages() {
        try {
            const response = await fetch(`${API_BASE}/messages`);
            if (!response.ok) throw new Error('Failed to fetch messages');
            const messages = await response.json();
            messageList.innerHTML = '';
            messages.forEach(appendMessage);
        } catch (err) {
            console.error('Error fetching messages:', err);
        }
    }

    // SSE Connection
    function setupSSE() {
        const eventSource = new EventSource(`${API_BASE}/stream`);
        
        eventSource.onmessage = (event) => {
            try {
                const newMessage = JSON.parse(event.data);
                appendMessage(newMessage);
            } catch (err) {
                console.error('Error parsing SSE message:', err);
            }
        };

        eventSource.onerror = (err) => {
            console.error('SSE Error:', err);
        };
    }

    // Form handling
    messageForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = messageInput.value.trim();
        if (!text) return;

        messageInput.value = '';

        try {
            const response = await fetch(`${API_BASE}/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ text })
            });

            if (!response.ok) {
                throw new Error('Failed to post message');
            }
        } catch (err) {
            console.error('Error posting message:', err);
            alert('Failed to send message');
        }
    });

    fetchMessages();
    setupSSE();
}

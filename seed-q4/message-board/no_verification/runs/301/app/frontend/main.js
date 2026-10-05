// Get DOM elements
const messagesContainer = document.getElementById('messages-container');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');

// Format timestamp for display
function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Render a message in the DOM
function renderMessage(message) {
  const messageElement = document.createElement('div');
  messageElement.className = 'message';
  
  messageElement.innerHTML = `
    <div class="message-text">${message.text}</div>
    <div class="message-time">${formatTime(message.created_at)}</div>
  `;
  
  messagesContainer.prepend(messageElement);
  messagesContainer.scrollTop = 0; // Auto-scroll to top for new messages
}

// Fetch initial messages from the API
async function fetchInitialMessages() {
  try {
    const response = await fetch('/api/messages');
    const messages = await response.json();
    
    // Render messages in reverse order (newest first)
    messages.forEach(renderMessage);
  } catch (error) {
    console.error('Error fetching initial messages:', error);
  }
}

// Set up SSE connection to receive real-time updates
function setupSSE() {
  const eventSource = new EventSource('/api/stream');
  
  eventSource.onmessage = (event) => {
    const newMessage = JSON.parse(event.data);
    renderMessage(newMessage);
  };
  
  eventSource.onerror = (error) => {
    console.error('SSE error:', error);
    eventSource.close();
    
    // Try to reconnect after 1 second
    setTimeout(setupSSE, 1000);
  };
}

// Handle form submission
async function handleSubmit(e) {
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
    
    if (response.ok) {
      messageInput.value = '';
    } else {
      const errorData = await response.json();
      console.error('Error posting message:', errorData.error);
    }
  } catch (error) {
    console.error('Error posting message:', error);
  }
}

// Set up event listeners
sendButton.addEventListener('click', handleSubmit);
messageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') handleSubmit(e);
});

// Initialize the app
fetchInitialMessages();
setupSSE();
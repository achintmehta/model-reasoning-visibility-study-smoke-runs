// Get DOM elements
const messagesContainer = document.getElementById('messages-container');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');

// Format date for display
function formatDate(dateString) {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric'
  }).format(date);
}

// Render a single message
function renderMessage(message) {
  const messageElement = document.createElement('div');
  messageElement.className = 'message';
  
  messageElement.innerHTML = `
    <div class="message-text">${message.text}</div>
    <div class="message-meta">${formatDate(message.created_at)}</div>
  `;
  
  messagesContainer.appendChild(messageElement);
  // Scroll to bottom when new message is added
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Fetch initial messages
async function fetchMessages() {
  try {
    const response = await fetch('http://localhost:3000/api/messages');
    const messages = await response.json();
    
    // Clear container and render messages in reverse order (newest first)
    messagesContainer.innerHTML = '';
    messages.reverse().forEach(renderMessage);
  } catch (error) {
    console.error('Error fetching messages:', error);
  }
}

// Set up SSE connection
function setupSSE() {
  const eventSource = new EventSource('http://localhost:3000/api/stream');
  
  eventSource.onmessage = (event) => {
    const message = JSON.parse(event.data);
    renderMessage(message);
  };
  
  eventSource.onerror = (error) => {
    console.error('SSE error:', error);
    // Try to reconnect after 5 seconds
    setTimeout(setupSSE, 5000);
  };
  
  eventSource.onopen = () => {
    console.log('SSE connection established');
  };
  
  // Store eventSource to close it when the page unloads
  window.eventSource = eventSource;
}

// Handle form submission
messageForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  
  if (!text) return;
  
  try {
    const response = await fetch('http://localhost:3000/api/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });
    
    if (response.ok) {
      messageInput.value = '';
    } else {
      console.error('Error posting message:', await response.json());
    }
  } catch (error) {
    console.error('Error posting message:', error);
  }
});

// Initialize the app
async function init() {
  await fetchMessages();
  setupSSE();
}

// Start the app when the DOM is loaded
document.addEventListener('DOMContentLoaded', init);
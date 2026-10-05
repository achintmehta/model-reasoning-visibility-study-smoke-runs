// Get DOM elements
const messageList = document.getElementById('message-list');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');

// Format timestamp as readable string
function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    hour: 'numeric', 
    minute: 'numeric' 
  });
}

// Render a single message
function renderMessage(message) {
  const messageElement = document.createElement('div');
  messageElement.className = 'message';
  
  const textElement = document.createElement('div');
  textElement.className = 'message-text';
  textElement.textContent = message.text;
  
  const timeElement = document.createElement('div');
  timeElement.className = 'message-time';
  timeElement.textContent = formatTime(message.created_at);
  
  messageElement.appendChild(textElement);
  messageElement.appendChild(timeElement);
  
  messageList.prepend(messageElement); // Add to top of list
}

// Fetch initial messages
async function fetchInitialMessages() {
  try {
    const response = await fetch('/api/messages');
    const messages = await response.json();
    
    // Clear message list and render all messages
    messageList.innerHTML = '';
    messages.forEach(renderMessage);
  } catch (error) {
    console.error('Failed to fetch initial messages:', error);
  }
}

// Set up SSE connection
function setupSSE() {
  const eventSource = new EventSource('/api/stream');
  
  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'newMessage') {
        renderMessage(data.data);
      }
    } catch (error) {
      console.error('Error processing SSE message:', error);
    }
  };
  
  eventSource.onerror = (error) => {
    console.error('SSE error:', error);
    eventSource.close();
    // Try to reconnect after a short delay
    setTimeout(setupSSE, 1000);
  };
}

// Handle form submission
async function handleSubmit(event) {
  event.preventDefault();
  const text = messageInput.value.trim();
  
  if (!text) return;
  
  try {
    await fetch('/api/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });
    
    messageInput.value = '';
  } catch (error) {
    console.error('Failed to post message:', error);
  }
}

// Initialize the app
async function init() {
  await fetchInitialMessages();
  setupSSE();
  messageForm.addEventListener('submit', handleSubmit);
}

// Start the app when the DOM is loaded
document.addEventListener('DOMContentLoaded', init);
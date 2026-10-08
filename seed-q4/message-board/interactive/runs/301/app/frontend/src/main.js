// DOM elements
const messagesContainer = document.getElementById('messages');
const messageForm = document.getElementById('messageForm');
const messageInput = document.getElementById('messageInput');

// Format date as "MMM DD, YYYY HH:MM"
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

// Create a message element
function createMessageElement(message) {
  const messageElement = document.createElement('div');
  messageElement.className = 'message new-message';
  
  messageElement.innerHTML = `
    <div class="message-content">${message.text}</div>
    <div class="message-meta">${formatDate(message.created_at)}</div>
  `;
  
  return messageElement;
}

// Render messages to the DOM
function renderMessages(messages) {
  messagesContainer.innerHTML = '';
  
  // Sort messages by creation date (newest first)
  messages.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  
  messages.forEach(message => {
    const messageElement = createMessageElement(message);
    messagesContainer.appendChild(messageElement);
  });
  
  // Scroll to bottom
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Fetch initial messages
async function fetchMessages() {
  try {
    const response = await fetch('/api/messages');
    const messages = await response.json();
    renderMessages(messages);
  } catch (error) {
    console.error('Error fetching messages:', error);
  }
}

// Set up SSE connection
function setupSSE() {
  const eventSource = new EventSource('/api/stream');
  
  eventSource.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const messageElement = createMessageElement(message);
    
    // Prepend new message to the top
    messagesContainer.insertBefore(messageElement, messagesContainer.firstChild);
    
    // Remove the "new-message" class after animation completes
    setTimeout(() => {
      messageElement.classList.remove('new-message');
    }, 300);
    
    // Scroll to top to see new message
    messagesContainer.scrollTop = 0;
  };
  
  eventSource.onerror = (error) => {
    console.error('SSE error:', error);
    eventSource.close();
    // Try to reconnect after 5 seconds
    setTimeout(setupSSE, 5000);
  };
  
  return eventSource;
}

// Handle form submission
async function handleSubmit(event) {
  event.preventDefault();
  
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
      console.error('Error submitting message:', errorData.error);
    }
  } catch (error) {
    console.error('Error submitting message:', error);
  }
}

// Initialize the app
async function init() {
  // Fetch initial messages
  await fetchMessages();
  
  // Set up SSE for real-time updates
  setupSSE();
  
  // Add event listener to form
  messageForm.addEventListener('submit', handleSubmit);
}

// Start the app when the DOM is loaded
document.addEventListener('DOMContentLoaded', init);
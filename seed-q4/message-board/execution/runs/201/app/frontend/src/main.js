// Get DOM elements
const messagesList = document.getElementById('messages-list');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');

// API base URL
const API_URL = 'http://localhost:3000/api';

// Format date for display
function formatDate(dateString) {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: 'numeric',
    month: 'short',
    day: 'numeric'
  }).format(date);
}

// Create a message element
function createMessageElement(message) {
  const messageElement = document.createElement('div');
  messageElement.className = 'message';
  
  messageElement.innerHTML = `
    <div class="message-text">${message.text}</div>
    <div class="message-time">${formatDate(message.created_at)}</div>
  `;
  
  return messageElement;
}

// Render messages
function renderMessages(messages) {
  // Clear existing messages
  messagesList.innerHTML = '';
  
  // Sort messages by creation date (newest first)
  const sortedMessages = [...messages].sort((a, b) => 
    new Date(b.created_at) - new Date(a.created_at)
  );
  
  // Add each message to the DOM
  sortedMessages.forEach(message => {
    const messageElement = createMessageElement(message);
    messagesList.appendChild(messageElement);
  });
  
  // Scroll to the bottom
  messagesList.scrollTop = messagesList.scrollHeight;
}

// Fetch initial messages
async function fetchInitialMessages() {
  try {
    const response = await fetch(`${API_URL}/messages`);
    const messages = await response.json();
    renderMessages(messages);
  } catch (error) {
    console.error('Failed to fetch initial messages:', error);
  }
}

// Set up SSE connection
function setupSSE() {
  const eventSource = new EventSource(`${API_URL}/stream`);
  
  eventSource.onmessage = (event) => {
    const newMessage = JSON.parse(event.data);
    const messageElement = createMessageElement(newMessage);
    
    // Prepend to the top of the messages list
    messagesList.insertBefore(messageElement, messagesList.firstChild);
    
    // Scroll to the top (newest message)
    messagesList.scrollTop = 0;
  };
  
  eventSource.onerror = (error) => {
    console.error('SSE error:', error);
    // Try to reconnect after 5 seconds
    setTimeout(setupSSE, 5000);
  };
}

// Handle form submission
async function handleSubmit(e) {
  e.preventDefault();
  
  const text = messageInput.value.trim();
  if (!text) return;
  
  try {
    const response = await fetch(`${API_URL}/messages`, {
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
      console.error('Failed to post message:', errorData.error);
    }
  } catch (error) {
    console.error('Failed to post message:', error);
  }
}

// Initialize the app
async function init() {
  // Set up event listeners
  messageForm.addEventListener('submit', handleSubmit);
  
  // Fetch initial messages
  await fetchInitialMessages();
  
  // Set up SSE
  setupSSE();
}

// Start the app when the DOM is loaded
document.addEventListener('DOMContentLoaded', init);
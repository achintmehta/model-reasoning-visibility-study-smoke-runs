// main.js - handles the message board functionality

// DOM Elements
const messageList = document.getElementById('message-list');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');

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

// Render messages to the DOM
function renderMessages(messages) {
  messageList.innerHTML = '';
  messages.forEach(message => {
    const messageItem = document.createElement('div');
    messageItem.className = 'message-item';
    
    const createdAt = new Date(message.created_at).toLocaleString();
    
    messageItem.innerHTML = `
      <div class="message-text">${escapeHtml(message.text)}</div>
      <div class="message-meta">${createdAt}</div>
    `;
    
    messageList.appendChild(messageItem);
  });
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
      const error = await response.json();
      console.error('Error submitting message:', error);
    }
  } catch (error) {
    console.error('Error submitting message:', error);
  }
}

// Set up SSE connection
function setupSSE() {
  const eventSource = new EventSource('/api/stream');
  
  eventSource.onmessage = (event) => {
    const message = JSON.parse(event.data);
    addMessageToDOM(message);
  };
  
  eventSource.onerror = (error) => {
    console.error('SSE error:', error);
    eventSource.close();
    // Try to reconnect after a delay
    setTimeout(setupSSE, 3000);
  };
}

// Add a single message to the DOM (for real-time updates)
function addMessageToDOM(message) {
  const messageItem = document.createElement('div');
  messageItem.className = 'message-item';
  
  const createdAt = new Date(message.created_at).toLocaleString();
  
  messageItem.innerHTML = `
    <div class="message-text">${escapeHtml(message.text)}</div>
    <div class="message-meta">${createdAt}</div>
  `;
  
  // Prepend to the top for newest first
  messageList.insertBefore(messageItem, messageList.firstChild);
  
  // Scroll to the top to see the newest message
  messageList.scrollTop = 0;
}

// Helper function to escape HTML to prevent XSS
function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Initialize the app
async function init() {
  await fetchMessages();
  setupSSE();
  messageForm.addEventListener('submit', handleSubmit);
}

// Start the app when the DOM is ready
document.addEventListener('DOMContentLoaded', init);
const messagesList = document.getElementById('messages-list');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');

// Format date as "YYYY-MM-DD HH:MM"
function formatDate(date) {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(date));
}

// Create a message element
function createMessageElement(message) {
  const messageEl = document.createElement('div');
  messageEl.className = 'message';
  
  const textEl = document.createElement('div');
  textEl.className = 'message-text';
  textEl.textContent = message.text;
  
  const timeEl = document.createElement('div');
  timeEl.className = 'message-time';
  timeEl.textContent = formatDate(message.created_at);
  
  messageEl.appendChild(textEl);
  messageEl.appendChild(timeEl);
  
  return messageEl;
}

// Fetch initial messages
async function fetchMessages() {
  try {
    const response = await fetch('http://localhost:3000/api/messages');
    const messages = await response.json();
    
    // Clear existing messages
    messagesList.innerHTML = '';
    
    // Add messages in reverse order (newest first)
    messages.forEach(message => {
      messagesList.appendChild(createMessageElement(message));
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
  }
}

// Connect to SSE stream
function connectToSSE() {
  const eventSource = new EventSource('http://localhost:3000/api/stream');
  
  eventSource.onmessage = (event) => {
    const message = JSON.parse(event.data);
    messagesList.insertBefore(createMessageElement(message), messagesList.firstChild);
    messagesList.scrollTop = 0; // Auto-scroll to top for new messages
  };
  
  eventSource.onerror = (error) => {
    console.error('SSE error:', error);
    eventSource.close();
    // Try to reconnect after 3 seconds
    setTimeout(connectToSSE, 3000);
  };
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
      const errorData = await response.json();
      console.error('Error posting message:', errorData.error);
    }
  } catch (error) {
    console.error('Error posting message:', error);
  }
});

// Initialize the app
async function init() {
  await fetchMessages();
  connectToSSE();
}

// Start the app when the DOM is ready
document.addEventListener('DOMContentLoaded', init);
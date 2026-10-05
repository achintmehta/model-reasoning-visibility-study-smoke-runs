// DOM elements
const messageList = document.getElementById('messageList');
const messageForm = document.getElementById('messageForm');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const status = document.getElementById('status');

let eventSource = null;

// Format timestamp for display
function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

// Create message element
function createMessageElement(message) {
  const div = document.createElement('div');
  div.className = 'message';
  div.dataset.id = message.id;
  
  const text = document.createElement('div');
  text.className = 'message-text';
  text.textContent = message.text;
  
  const time = document.createElement('div');
  time.className = 'message-time';
  time.textContent = formatTimestamp(message.created_at);
  
  div.appendChild(text);
  div.appendChild(time);
  return div;
}

// Load initial messages
async function loadInitialMessages() {
  try {
    const response = await fetch('http://localhost:3001/api/messages');
    
    if (!response.ok) {
      throw new Error('Failed to load messages');
    }
    
    const messages = await response.json();
    messages.forEach(message => {
      messageList.appendChild(createMessageElement(message));
    });
    
    status.textContent = 'Connected to live updates';
    status.className = 'status connected';
  } catch (error) {
    console.error('Error loading messages:', error);
    status.textContent = 'Error connecting to server';
    status.className = 'status error';
  }
}

// Connect to SSE stream
function connectToStream() {
  try {
    const eventSource = new EventSource('http://localhost:3001/api/stream');
    
    eventSource.onopen = () => {
      console.log('SSE connection established');
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Check if it's an end marker or error
        if (data === ': end') {
          eventSource.close();
          return;
        }
        
        if (data.error) {
          console.error('Server error:', data.error);
          status.textContent = 'Server error';
          status.className = 'status error';
          eventSource.close();
          return;
        }
        
        // Add new message to the list
        const messageElement = createMessageElement(data);
        messageList.appendChild(messageElement);
        
        // Scroll to bottom
        messageList.scrollTop = messageList.scrollHeight;
        
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    };

    eventSource.onerror = (error) => {
      console.error('SSE error:', error);
      status.textContent = 'Disconnected from live updates';
      status.className = 'status disconnected';
      eventSource.close();
    };

    eventSource.addEventListener('error', (event) => {
      const data = event.data ? JSON.parse(event.data) : null;
      if (data && data.error) {
        console.error('Server error:', data.error);
        status.textContent = 'Server error';
        status.className = 'status error';
      }
    });

    eventSource.addEventListener(': connected', () => {
      console.log('SSE connected');
      status.textContent = 'Connected to live updates';
      status.className = 'status connected';
    });

    // Store event source for cleanup if needed
    eventSource = eventSource;
    
  } catch (error) {
    console.error('Error connecting to SSE:', error);
    status.textContent = 'Error connecting to server';
    status.className = 'status error';
  }
}

// Send new message
async function sendMessage(text) {
  try {
    const response = await fetch('http://localhost:3001/api/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });
    
    if (!response.ok) {
      throw new Error('Failed to send message');
    }
    
    const message = await response.json();
    const messageElement = createMessageElement(message);
    messageList.appendChild(messageElement);
    
    // Clear input and scroll to bottom
    messageInput.value = '';
    messageList.scrollTop = messageList.scrollHeight;
    
    sendButton.disabled = false;
    sendButton.textContent = 'Send';
    
  } catch (error) {
    console.error('Error sending message:', error);
    status.textContent = 'Error sending message';
    status.className = 'status error';
    
    sendButton.disabled = false;
    sendButton.textContent = 'Send';
  }
}

// Event listener for form submission
messageForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  
  const text = messageInput.value.trim();
  if (!text) return;
  
  // Disable button and show loading state
  sendButton.disabled = true;
  sendButton.textContent = 'Sending...';
  
  await sendMessage(text);
});

// Initialize the application
async function init() {
  await loadInitialMessages();
  connectToStream();
}

// Start the application
init();

// DOM elements
const messageList = document.getElementById('messageList');
const messageForm = document.getElementById('messageForm');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const status = document.getElementById('status');

// Add inline styles for the UI
const style = document.createElement('style');
style.textContent = `
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }

  .container {
    background: white;
    border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    overflow: hidden;
    width: 100%;
    max-width: 600px;
  }

  h1 {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 24px;
    text-align: center;
    font-size: 1.5rem;
    font-weight: 600;
    margin: 0;
  }

  .message-list {
    height: 500px;
    overflow-y: auto;
    padding: 20px;
    background: #f8f9fa;
  }

  .message {
    background: white;
    border: 1px solid #e9ecef;
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 12px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
    animation: slideIn 0.3s ease-out;
  }

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .message-text {
    color: #333;
    font-size: 1rem;
    line-height: 1.5;
    margin-bottom: 8px;
    word-wrap: break-word;
  }

  .message-time {
    color: #6c757d;
    font-size: 0.75rem;
    font-weight: 500;
  }

  .message-form {
    padding: 20px;
    background: white;
    border-top: 1px solid #e9ecef;
  }

  .message-form input {
    width: 100%;
    padding: 12px 16px;
    border: 2px solid #e9ecef;
    border-radius: 8px;
    font-size: 1rem;
    transition: border-color 0.2s;
    margin-bottom: 12px;
  }

  .message-form input:focus {
    outline: none;
    border-color: #667eea;
  }

  .message-form button {
    width: 100%;
    padding: 12px 16px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.2s, transform 0.1s;
  }

  .message-form button:hover {
    opacity: 0.9;
  }

  .message-form button:active {
    transform: scale(0.98);
  }

  .message-form button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .status {
    padding: 12px 20px;
    text-align: center;
    font-size: 0.875rem;
    font-weight: 500;
  }

  .status.connected {
    color: #28a745;
    background: #d4edda;
  }

  .status.disconnected {
    color: #6c757d;
    background: #e2e3e5;
  }

  .status.error {
    color: #dc3545;
    background: #f8d7da;
  }

  .message-list::-webkit-scrollbar {
    width: 8px;
  }

  .message-list::-webkit-scrollbar-track {
    background: #f1f1f1;
    border-radius: 4px;
  }

  .message-list::-webkit-scrollbar-thumb {
    background: #888;
    border-radius: 4px;
  }

  .message-list::-webkit-scrollbar-thumb:hover {
    background: #555;
  }

  @media (max-width: 640px) {
    h1 {
      font-size: 1.25rem;
      padding: 16px;
    }

    .message-list {
      height: 400px;
      padding: 16px;
    }

    .message-form {
      padding: 16px;
    }
  }
`;
document.head.appendChild(style);

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

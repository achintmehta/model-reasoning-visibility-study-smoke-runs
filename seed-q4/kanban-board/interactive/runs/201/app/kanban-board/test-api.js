import { initDB, createCard, getBoardState } from './src/db.js';

async function testAPI() {
  try {
    console.log('Initializing database...');
    await initDB();
    
    console.log('Creating a test card...');
    const card = await createCard('todo', 'Test Card');
    console.log('Created card:', card);
    
    console.log('Getting board state...');
    const boardState = await getBoardState();
    console.log('Board state:', boardState);
    
  } catch (error) {
    console.error('Error testing API:', error);
    process.exit(1);
  }
}

testAPI();
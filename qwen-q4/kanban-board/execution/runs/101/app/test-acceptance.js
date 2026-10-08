#!/usr/bin/env node

/**
 * Comprehensive test for Kanban board acceptance criteria.
 */

import http from 'http';

const BASE = 'http://localhost:4000';

function fetchJSON(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const req = http.request(url, {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

function listenSSE(durationMs = 1000) {
  return new Promise((resolve) => {
    const events = [];
    const url = new URL('/api/stream', BASE);
    const req = http.get(url, (res) => {
      let buffer = '';
      res.on('data', chunk => {
        buffer += chunk.toString();
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';
        for (const block of lines) {
          const match = block.match(/^data: (.+)$/);
          if (match) {
            try {
              events.push(JSON.parse(match[1]));
            } catch (e) {}
          }
        }
      });
    });
    req.on('error', () => resolve(events));

    // Force close after duration
    setTimeout(() => {
      req.destroy();
      resolve(events);
    }, durationMs);
  });
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log('\n=== Kanban Board Acceptance Criteria Tests ===\n');

  // ---- Test 1: Initial board state ----
  console.log('Test 1: Initial board state');
  const { body: initialBoard } = await fetchJSON('/api/board');
  assert(initialBoard.length === 3, 'Board has 3 columns');
  assert(initialBoard[0].title === 'To Do', 'First column is "To Do"');
  assert(initialBoard[1].title === 'In Progress', 'Second column is "In Progress"');
  assert(initialBoard[2].title === 'Done', 'Third column is "Done"');
  assert(initialBoard.every(c => c.cards.length === 0), 'All columns are empty');

  // ---- Test 2: Create card appears on board ----
  console.log('\nTest 2: Card creation');
  const { body: card1 } = await fetchJSON('/api/cards', {
    method: 'POST',
    body: { column_id: 'col-todo', text: 'Card A' }
  });
  assert(card1.id.startsWith('card-'), 'Card has valid ID');
  assert(card1.column_id === 'col-todo', 'Card is in correct column');
  assert(card1.text === 'Card A', 'Card text matches');

  const { body: card2 } = await fetchJSON('/api/cards', {
    method: 'POST',
    body: { column_id: 'col-todo', text: 'Card B' }
  });
  assert(card2.id !== card1.id, 'Second card has different ID');

  const { body: boardAfterCreate } = await fetchJSON('/api/board');
  const todoCol = boardAfterCreate.find(c => c.id === 'col-todo');
  assert(todoCol.cards.length === 2, 'To Do column has 2 cards');
  assert(todoCol.cards[0].id === card1.id, 'Card A is first (lower position)');
  assert(todoCol.cards[1].id === card2.id, 'Card B is second (higher position)');

  // ---- Test 3: Card appears on every connected client (via SSE) ----
  console.log('\nTest 3: Real-time sync via SSE');
  
  // Start listening for SSE events
  const ssePromise = listenSSE(2000);
  
  // Create a card while SSE is listening
  const { body: card3 } = await fetchJSON('/api/cards', {
    method: 'POST',
    body: { column_id: 'col-progress', text: 'Card C' }
  });
  
  // Wait for SSE to collect events
  const sseEvents = await ssePromise;
  
  assert(sseEvents.length >= 1, `SSE received ${sseEvents.length} event(s)`);
  const createEvent = sseEvents.find(e => e.type === 'create' && e.card.id === card3.id);
  assert(createEvent !== undefined, 'SSE broadcasted the create event');
  if (createEvent) {
    assert(createEvent.card.column_id === 'col-progress', 'SSE event has correct column');
  }

  // ---- Test 4: Move card across columns ----
  console.log('\nTest 4: Move card across columns');
  const { body: movedCard } = await fetchJSON(`/api/cards/${card1.id}/move`, {
    method: 'PATCH',
    body: { column_id: 'col-progress', before_id: null, after_id: null }
  });
  assert(movedCard.column_id === 'col-progress', 'Card moved to In Progress');

  const { body: boardAfterMove } = await fetchJSON('/api/board');
  const todoCol2 = boardAfterMove.find(c => c.id === 'col-todo');
  const progressCol = boardAfterMove.find(c => c.id === 'col-progress');
  
  assert(!todoCol2.cards.find(c => c.id === card1.id), 'Card removed from To Do');
  assert(progressCol.cards.find(c => c.id === card1.id), 'Card exists in In Progress');

  // Verify card is in exactly one column
  let cardCount = 0;
  for (const col of boardAfterMove) {
    if (col.cards.find(c => c.id === card1.id)) cardCount++;
  }
  assert(cardCount === 1, 'Card exists in exactly one column');

  // ---- Test 5: SSE broadcasts move event ----
  console.log('\nTest 5: SSE broadcasts move event');
  const ssePromise2 = listenSSE(2000);
  
  const { body: card4 } = await fetchJSON('/api/cards', {
    method: 'POST',
    body: { column_id: 'col-done', text: 'Card D' }
  });
  
  await fetchJSON(`/api/cards/${card4.id}/move`, {
    method: 'PATCH',
    body: { column_id: 'col-todo', before_id: null, after_id: null }
  });
  
  const sseEvents2 = await ssePromise2;
  const moveEvent = sseEvents2.find(e => e.type === 'move' && e.card.id === card4.id);
  assert(moveEvent !== undefined, 'SSE broadcasted the move event');
  if (moveEvent) {
    assert(moveEvent.card.column_id === 'col-todo', 'Move event has correct target column');
  }

  // ---- Test 6: Reorder within a column ----
  console.log('\nTest 6: Reorder within a column');
  const { body: card5 } = await fetchJSON('/api/cards', {
    method: 'POST',
    body: { column_id: 'col-todo', text: 'Card E' }
  });

  // Move Card B before Card D in To Do
  const { body: reordered } = await fetchJSON(`/api/cards/${card2.id}/move`, {
    method: 'PATCH',
    body: { column_id: 'col-todo', before_id: card4.id, after_id: null }
  });
  assert(reordered.column_id === 'col-todo', 'Card stayed in To Do');

  const { body: boardAfterReorder } = await fetchJSON('/api/board');
  const todoCards = boardAfterReorder.find(c => c.id === 'col-todo').cards;
  const cardBIdx = todoCards.findIndex(c => c.id === card2.id);
  const cardDIdx = todoCards.findIndex(c => c.id === card4.id);
  assert(cardBIdx < cardDIdx, 'Card B is now before Card D');

  // ---- Test 7: Concurrent moves converge ----
  console.log('\nTest 7: Concurrent moves converge');
  const { body: card6 } = await fetchJSON('/api/cards', {
    method: 'POST',
    body: { column_id: 'col-done', text: 'Card F' }
  });

  // Simulate two clients moving the same card to different columns concurrently
  const [result1, result2] = await Promise.all([
    fetchJSON(`/api/cards/${card6.id}/move`, {
      method: 'PATCH',
      body: { column_id: 'col-todo', before_id: null, after_id: null }
    }),
    fetchJSON(`/api/cards/${card6.id}/move`, {
      method: 'PATCH',
      body: { column_id: 'col-progress', before_id: null, after_id: null }
    })
  ]);

  // Both should succeed (last-write-wins)
  assert(result1.status === 200 || result2.status === 200, 'At least one move succeeded');

  // Check final state - card should be in exactly one column
  const { body: boardAfterConcurrent } = await fetchJSON('/api/board');
  let concurrentCount = 0;
  let finalColumn = null;
  for (const col of boardAfterConcurrent) {
    if (col.cards.find(c => c.id === card6.id)) {
      concurrentCount++;
      finalColumn = col.id;
    }
  }
  assert(concurrentCount === 1, 'Card exists in exactly one column after concurrent moves');
  assert(finalColumn !== null, 'Card was not lost');

  // ---- Test 8: Reload reproduces server state ----
  console.log('\nTest 8: Reload reproduces server state');
  const { body: boardReload1 } = await fetchJSON('/api/board');
  const { body: boardReload2 } = await fetchJSON('/api/board');
  
  assert(
    JSON.stringify(boardReload1) === JSON.stringify(boardReload2),
    'Two fetches return identical board state'
  );

  // ---- Test 9: Card ordering is total and stable ----
  console.log('\nTest 9: Total ordering within columns');
  for (const col of boardReload1) {
    const positions = col.cards.map(c => c.position);
    const sorted = [...positions].sort((a, b) => a - b);
    assert(
      JSON.stringify(positions) === JSON.stringify(sorted),
      `Column "${col.title}" cards are in ascending position order`
    );
    // No duplicate positions
    const uniquePositions = new Set(positions);
    assert(
      uniquePositions.size === positions.length,
      `Column "${col.title}" has no duplicate positions`
    );
  }

  // ---- Test 10: Cross-column move with specific ordering ----
  console.log('\nTest 10: Cross-column move with specific ordering');
  const { body: card7 } = await fetchJSON('/api/cards', {
    method: 'POST',
    body: { column_id: 'col-done', text: 'Card G' }
  });

  // Move Card G to To Do, between Card B and Card D
  const { body: inserted } = await fetchJSON(`/api/cards/${card7.id}/move`, {
    method: 'PATCH',
    body: { column_id: 'col-todo', before_id: card4.id, after_id: card2.id }
  });
  assert(inserted.column_id === 'col-todo', 'Card moved to To Do');

  const { body: finalBoard } = await fetchJSON('/api/board');
  const finalTodo = finalBoard.find(c => c.id === 'col-todo').cards;
  const bIdx = finalTodo.findIndex(c => c.id === card2.id);
  const gIdx = finalTodo.findIndex(c => c.id === card7.id);
  const dIdx = finalTodo.findIndex(c => c.id === card4.id);
  assert(
    bIdx < gIdx && gIdx < dIdx,
    'Card G is correctly positioned between Card B and Card D'
  );

  // ---- Summary ----
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});

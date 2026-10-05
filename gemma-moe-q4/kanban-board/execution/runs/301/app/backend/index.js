import express from 'express';
import cors from 'cors';
import { EventEmitter } from 'events';
import db from './db.js';
import { initDb } from './init-db.js';
import crypto from 'crypto';

const app = express();
app.use(cors());
app.use(express.json());

const eventEmitter = new EventEmitter();

// SSE client management
let clients = [];

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  clients.push(newClient);

  console.log(`Client connected: ${clientId}. Total clients: ${clients.length}`);

  req.on('close', () => {
    console.log(`Client disconnected: ${clientId}`);
    clients = clients.filter(client => client.id !== clientId);
  });
});

const broadcast = (event, data) => {
  const payload = `data: ${JSON.stringify({ event, data })}\n\n`;
  clients.forEach(client => client.res.write(payload));
};

// API endpoints

app.get('/api/board', async (req, res) => {
  try {
    const columnsResult = await db.query('SELECT * FROM columns ORDER BY position ASC');
    const columns = columnsResult.rows;

    const columnsWithCards = await Promise.all(columns.map(async (column) => {
      const cardsResult = await db.query(
        'SELECT * FROM cards WHERE column_id = $1 ORDER BY position ASC',
        [column.id]
      );
      return {
        ...column,
        cards: cardsResult.rows
      };
    }));

    res.json(columnsWithCards);
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/api/cards', async (req, res) => {
  const { columnId, text } = req.body;
  if (!columnId || !text) {
    return res.status(400).send('Missing columnId or text');
  }

  try {
    // Get the last card's position in the column to append new card
    const { rows: lastCards } = await db.query(
      'SELECT position FROM cards WHERE column_id = $1 ORDER BY position DESC LIMIT 1',
      [columnId]
    );

    let newPosition = 1.0;
    if (lastCards.length > 0) {
      newPosition = lastCards[0].position + 1.0;
    }

    const cardId = crypto.randomUUID();
    const { rows: [newCard] } = await db.query(
      'INSERT INTO cards (id, column_id, text, position) VALUES ($1, $2, $3, $4) RETURNING *',
      [cardId, columnId, text, newPosition]
    );

    broadcast('card-created', newCard);

    res.status(201).json(newCard);
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

app.patch('/api/cards/:id/move', async (req, res) => {
  const { id } = req.params;
  const { columnId, beforeId, afterId } = req.body;

  try {
    let updatedCard;

    await db.transaction(async (tx) => {
      // 1. Get current card state
      const { rows: [card] } = await tx.query('SELECT * FROM cards WHERE id = $1', [id]);
      if (!card) throw new Error('Card not found');

      // 2. Calculate new position
      let newPosition = 0;

      if (beforeId && afterId) {
        // Between two cards
        const { rows: [beforeCard] } = await tx.query('SELECT position FROM cards WHERE id = $1', [beforeId]);
        const { rows: [afterCard] } = await tx.query('SELECT position FROM cards WHERE id = $1', [afterId]);
        
        if (beforeCard && afterCard) {
          newPosition = (beforeCard.position + afterCard.position) / 2;
        } else if (beforeCard) {
          newPosition = beforeCard.position + 0.5;
        } else if (afterCard) {
          newPosition = afterCard.position - 0.5;
        }
      } else if (beforeId) {
        // Before some card
        const { rows: [beforeCard] } = await tx.query('SELECT position FROM cards WHERE id = $1', [beforeId]);
        if (beforeCard) {
            const { rows: [prevCard] } = await tx.query(
                'SELECT position FROM cards WHERE column_id = $1 AND position < $2 ORDER BY position DESC LIMIT 1',
                [columnId, beforeCard.position]
            );
            if (prevCard) {
                newPosition = (prevCard.position + beforeCard.position) / 2;
            } else {
                newPosition = beforeCard.position - 1.0;
            }
        } else {
            newPosition = 1.0;
        }
      } else if (afterId) {
        // After some card
        const { rows: [afterCard] } = await tx.query('SELECT position FROM cards WHERE id = $1', [afterId]);
        if (afterCard) {
            const { rows: [nextCard] } = await tx.query(
                'SELECT position FROM cards WHERE column_id = $1 AND position > $2 ORDER BY position ASC LIMIT 1',
                [columnId, afterCard.position]
            );
            if (nextCard) {
                newPosition = (afterCard.position + nextCard.position) / 2;
            } else {
                newPosition = afterCard.position + 1.0;
            }
        } else {
            newPosition = 1.0;
        }
      } else {
        // End of column
        const { rows: [lastCard] } = await tx.query('SELECT position FROM cards WHERE column_id = $1 ORDER BY position DESC LIMIT 1', [columnId]);
        newPosition = lastCard ? lastCard.position + 1.0 : 1.0;
      }

      // If newPosition is 0 (shouldn't happen with the above logic), fallback
      if (newPosition === 0) newPosition = 1.0;

      // 3. Update the card
      const { rows: [resCard] } = await tx.query(
        'UPDATE cards SET column_id = $1, position = $2 WHERE id = $3 RETURNING *',
        [columnId, newPosition, id]
      );
      updatedCard = resCard;
    });

    if (updatedCard) {
      broadcast('card-moved', updatedCard);
      res.json(updatedCard);
    } else {
      res.status(500).send('Failed to move card');
    }

  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

const PORT = 3001;

async function startServer() {
  await initDb();
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

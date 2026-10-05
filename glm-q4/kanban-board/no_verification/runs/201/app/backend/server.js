const express = require('express');
const cors = require('cors');
const { PGLite } = require('@electric-sql/pglite');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// PGLite database with file persistence
const pg = new PGLite({
  dataDir: path.join(__dirname, '../data'),
  dataFile: 'kanban.db'
});

let connections = [];
const broadcast = (data) => {
  connections.forEach(conn => {
    if (conn.readyState === conn.OPEN) {
      conn.send(JSON.stringify(data));
    }
  });
};

// Initialize database
const initDatabase = async () => {
  try {
    await pg.exec(`
      CREATE TABLE IF NOT EXISTS columns (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        position INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS cards (
        id TEXT PRIMARY KEY,
        column_id TEXT NOT NULL,
        text TEXT NOT NULL,
        position NUMERIC NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (column_id) REFERENCES columns(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_cards_column_id ON cards(column_id);
      CREATE INDEX IF NOT EXISTS idx_cards_position ON cards(position);
    `);

    // Seed default columns if none exist
    const columns = await pg.query('SELECT COUNT(*) as count FROM columns');
    if (parseInt(columns[0].count) === 0) {
      await pg.exec(`
        INSERT INTO columns (id, title, position) VALUES
        ('todo', 'To Do', 0),
        ('in-progress', 'In Progress', 1),
        ('done', 'Done', 2)
      `);
    }

    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
  }
};

// Board state endpoint
app.get('/api/board', async (req, res) => {
  try {
    const result = await pg.query(`
      SELECT 
        c.id as column_id,
        c.title as column_title,
        c.position as column_position,
        card.id as card_id,
        card.text as card_text,
        card.position as card_position,
        card.created_at as card_created_at
      FROM columns c
      LEFT JOIN cards card ON card.column_id = c.id
      ORDER BY c.position, card.position
    `);

    const columns = {};
    result.forEach(row => {
      if (!columns[row.column_id]) {
        columns[row.column_id] = {
          id: row.column_id,
          title: row.column_title,
          position: row.column_position,
          cards: []
        };
      }
      if (row.card_id) {
        columns[row.column_id].cards.push({
          id: row.card_id,
          text: row.card_text,
          position: row.card_position,
          created_at: row.card_created_at
        });
      }
    });

    res.json(Object.values(columns));
  } catch (error) {
    console.error('Error fetching board:', error);
    res.status(500).json({ error: 'Failed to fetch board' });
  }
});

// Create card endpoint
app.post('/api/cards', async (req, res) => {
  try {
    const { columnId, text } = req.body;
    
    if (!columnId || !text) {
      return res.status(400).json({ error: 'columnId and text are required' });
    }

    // Get the highest position in the column
    const positionResult = await pg.query(
      'SELECT MAX(position) as max_position FROM cards WHERE column_id = ?',
      [columnId]
    );
    const newPosition = positionResult[0].max_position + 1;

    const cardId = `card-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const result = await pg.query(
      `INSERT INTO cards (id, column_id, text, position) 
       VALUES (?, ?, ?, ?) 
       RETURNING *`,
      [cardId, columnId, text, newPosition]
    );

    broadcast({
      type: 'card-created',
      card: result[0]
    });

    res.json(result[0]);
  } catch (error) {
    console.error('Error creating card:', error);
    res.status(500).json({ error: 'Failed to create card' });
  }
});

// Move card endpoint
app.patch('/api/cards/:id/move', async (req, res) => {
  try {
    const { id } = req.params;
    const { columnId, beforeId, afterId } = req.body;

    if (!columnId) {
      return res.status(400).json({ error: 'columnId is required' });
    }

    // Get current card position
    const cardResult = await pg.query('SELECT * FROM cards WHERE id = ?', [id]);
    if (cardResult.length === 0) {
      return res.status(404).json({ error: 'Card not found' });
    }

    const card = cardResult[0];
    const newPosition = calculatePosition(card.column_id, columnId, beforeId, afterId);

    // Check if we need to renormalize the column
    const needsRenormalization = await checkRenormalizationNeeded(card.column_id, columnId);

    await pg.transaction(async () => {
      // Remove card from old column (if different)
      if (card.column_id !== columnId) {
        await pg.query('DELETE FROM cards WHERE id = ?', [id]);
      }

      // Insert at new position
      if (card.column_id === columnId) {
        await pg.query(
          `UPDATE cards SET position = ? WHERE id = ?`,
          [newPosition, id]
        );
      } else {
        await pg.query(
          `INSERT INTO cards (id, column_id, text, position) 
           VALUES (?, ?, ?, ?)`,
          [id, columnId, card.text, newPosition]
        );
      }

      // If needed, renormalize the column
      if (needsRenormalization) {
        await renormalizeColumn(columnId);
      }
    });

    // Get the updated card
    const updatedCard = await pg.query('SELECT * FROM cards WHERE id = ?', [id]);

    broadcast({
      type: 'card-moved',
      card: updatedCard[0]
    });

    res.json(updatedCard[0]);
  } catch (error) {
    console.error('Error moving card:', error);
    res.status(500).json({ error: 'Failed to move card' });
  }
});

// Calculate new position
const calculatePosition = async (oldColumnId, newColumnId, beforeId, afterId) => {
  if (beforeId && afterId) {
    // Position between two cards
    const [beforeResult, afterResult] = await Promise.all([
      pg.query('SELECT position FROM cards WHERE id = ?', [beforeId]),
      pg.query('SELECT position FROM cards WHERE id = ?', [afterId])
    ]);
    return (beforeResult[0].position + afterResult[0].position) / 2;
  } else if (beforeId) {
    // Position before a card, at the start
    const beforeResult = await pg.query('SELECT position FROM cards WHERE id = ?', [beforeId]);
    return beforeResult[0].position / 2;
  } else if (afterId) {
    // Position after a card, at the end
    const afterResult = await pg.query('SELECT position FROM cards WHERE id = ?', [afterId]);
    return (afterResult[0].position + 1000) / 2;
  } else {
    // No before or after ID, append to end
    const positionResult = await pg.query(
      'SELECT MAX(position) as max_position FROM cards WHERE column_id = ?',
      [newColumnId]
    );
    return (positionResult[0].max_position || 0) + 1;
  }
};

// Check if renormalization is needed
const checkRenormalizationNeeded = async (oldColumnId, newColumnId) => {
  if (oldColumnId === newColumnId) {
    // Check if any positions are too close (collision)
    const result = await pg.query(`
      SELECT COUNT(*) as count
      FROM cards
      WHERE column_id = ?
      AND position < 0.01
    `, [newColumnId]);
    return parseInt(result[0].count) > 0;
  }
  return false;
};

// Renormalize column positions
const renormalizeColumn = async (columnId) => {
  const result = await pg.query(`
    SELECT id, position
    FROM cards
    WHERE column_id = ?
    ORDER BY position
  `, [columnId]);

  const promises = result.map((row, index) => {
    const newPos = index + 1;
    return pg.query('UPDATE cards SET position = ? WHERE id = ?', [newPos, row.id]);
  });

  await Promise.all(promises);
};

// SSE endpoint
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const client = {
    id: Date.now(),
    readyState: 'OPEN'
  };

  connections.push(client);

  req.on('close', () => {
    connections = connections.filter(c => c.id !== client.id);
  });

  // Send welcome message
  res.write(': connected\n\n');
});

// Start server
(async () => {
  await initDatabase();
  
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
})();

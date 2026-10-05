import express from 'express';
import cors from 'cors';
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

// Initialize PGlite with filesystem persistence
const dbPath = path.join(__dirname, 'data');
const db = new PGlite(dbPath);

// Array to keep track of SSE clients
let clients = [];

async function initDb() {
    await db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
            id SERIAL PRIMARY KEY,
            text TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);
    console.log('Database initialized');
}

initDb().catch(console.error);

// GET /api/messages - Fetch message history
app.get('/api/messages', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM messages ORDER BY created_at ASC');
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching messages');
    }
});

// GET /api/stream - SSE endpoint
app.get('/api/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const clientId = Date.now();
    const newClient = {
        id: clientId,
        res
    };

    clients.push(newClient);
    console.log(`New client connected: ${clientId}. Total clients: ${clients.length}`);

    req.on('close', () => {
        console.log(`Client disconnected: ${clientId}`);
        clients = clients.filter(client => client.id !== clientId);
    });
});

// POST /api/messages - Post a new message
app.post('/api/messages', async (req, res) => {
    const { text } = req.body;
    if (!text) {
        return res.status(400).send('Text is required');
    }

    try {
        const result = await db.query(
            'INSERT INTO messages (text) VALUES ($1) RETURNING *',
            [text]
        );
        const newMessage = result.rows[0];

        // Broadcast to all SSE clients
        const data = JSON.stringify(newMessage);
        clients.forEach(client => {
            client.res.write(`data: ${data}\n\n`);
        });

        res.status(201).json(newMessage);
    } catch (error) {
        console.error(error);
        res.status(500).send('Error saving message');
    }
});

app.listen(port, () => {
    console.log(`Backend server listening at http://localhost:${port}`);
});

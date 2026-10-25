import { createServer } from 'node:http';
import { database } from './services.js';

const pool = database();
const server = createServer(async (request, response) => {
  if (request.method !== 'GET' || request.url !== '/health') {
    response.writeHead(404).end('Not found');
    return;
  }
  try {
    const result = await pool.query('SELECT 1 AS connected');
    response.writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ ok: result.rows[0]?.connected === 1 }));
  } catch {
    response.writeHead(503, { 'content-type': 'application/json' })
      .end(JSON.stringify({ ok: false }));
  }
});

server.listen(Number(process.env.PORT ?? 3000), () => {
  console.log('Digimart health server listening');
});

process.on('SIGTERM', () => server.close(() => void pool.end()));

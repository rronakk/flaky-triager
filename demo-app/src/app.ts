import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import type Database from 'better-sqlite3';
import { createTaskRouter } from './routes/tasks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(db: Database.Database): express.Application {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.use('/tasks', createTaskRouter(db));

  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  app.use(express.static(clientDist));
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });

  return app;
}

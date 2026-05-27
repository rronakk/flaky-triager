import { Router } from 'express';
import type Database from 'better-sqlite3';
import {
  createTask,
  getTasks,
  updateTask,
  deleteTask,
  getStats,
} from '../services/taskService.js';
import { validateCreateInput, validateUpdateInput } from '../utils/validation.js';

export function createTaskRouter(db: Database.Database): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const status = req.query.status as string | undefined;
    const tasks = getTasks(db, status ? { status } : undefined);
    res.json(tasks);
  });

  router.post('/', (req, res) => {
    const validation = validateCreateInput(req.body);
    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }
    const task = createTask(db, req.body);
    res.status(201).json(task);
  });

  router.patch('/:id', (req, res) => {
    const validation = validateUpdateInput(req.body);
    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }
    try {
      const task = updateTask(db, Number(req.params.id), req.body);
      res.json(task);
    } catch {
      res.status(404).json({ error: 'Task not found' });
    }
  });

  router.delete('/:id', (req, res) => {
    deleteTask(db, Number(req.params.id));
    res.status(204).end();
  });

  router.get('/stats', (req, res) => {
    const stats = getStats(db);
    res.json(stats);
  });

  router.post('/notify', async (req, res) => {
    const { webhookUrl, taskId } = req.body;
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'task.created', taskId }),
        signal: AbortSignal.timeout(2000),
      });
      res.json({ notified: true, status: response.status });
    } catch {
      res.status(502).json({ notified: false, error: 'Webhook delivery failed' });
    }
  });

  router.patch('/:id/complete', (req, res) => {
    try {
      const task = updateTask(db, Number(req.params.id), { status: 'done' });
      res.json({ ...task, completedAt: new Date().toISOString() });
    } catch {
      res.status(404).json({ error: 'Task not found' });
    }
  });

  return router;
}

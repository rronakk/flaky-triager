import { describe, it, expect, beforeEach } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import Database from 'better-sqlite3';
import { createDb } from '../../src/db.js';
import {
  createTask,
  getTasks,
  getTask,
  updateTask,
  deleteTask,
  getStats,
  createTaskWithCache,
  getCachedTask,
  clearCache,
  getTasksByIds,
} from '../../src/services/taskService.js';

describe('taskService', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createDb(':memory:');
  });

  it('creates a task and returns it with an id', () => {
    const task = createTask(db, { title: 'Buy groceries' });
    expect(task.id).toBeDefined();
    expect(task.title).toBe('Buy groceries');
    expect(task.status).toBe('pending');
    expect(task.description).toBeNull();
  });

  it('gets all tasks', () => {
    createTask(db, { title: 'Task 1' });
    createTask(db, { title: 'Task 2' });
    const tasks = getTasks(db);
    expect(tasks).toHaveLength(2);
  });

  it('filters tasks by status', () => {
    createTask(db, { title: 'Task 1' });
    const task2 = createTask(db, { title: 'Task 2' });
    updateTask(db, task2.id, { status: 'done' });

    const pending = getTasks(db, { status: 'pending' });
    expect(pending).toHaveLength(1);
    expect(pending[0].title).toBe('Task 1');

    const done = getTasks(db, { status: 'done' });
    expect(done).toHaveLength(1);
    expect(done[0].title).toBe('Task 2');
  });

  it('updates a task', () => {
    const task = createTask(db, { title: 'Original' });
    const updated = updateTask(db, task.id, { title: 'Updated', status: 'done' });
    expect(updated.title).toBe('Updated');
    expect(updated.status).toBe('done');
  });

  it('deletes a task', () => {
    const task = createTask(db, { title: 'To delete' });
    deleteTask(db, task.id);
    const tasks = getTasks(db);
    expect(tasks).toHaveLength(0);
  });

  it('returns correct stats', () => {
    createTask(db, { title: 'Task 1' });
    createTask(db, { title: 'Task 2' });
    const task3 = createTask(db, { title: 'Task 3' });
    updateTask(db, task3.id, { status: 'done' });

    const stats = getStats(db);
    expect(stats.total).toBe(3);
    expect(stats.pending).toBe(2);
    expect(stats.done).toBe(1);
    expect(stats.completionPercentage).toBeCloseTo(33.33, 1);
  });
});

describe('taskService - cache (FLAKY: async race condition)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createDb(':memory:');
    clearCache();
  });

  it('should populate cache after creating a task', async () => {
    const task = await createTaskWithCache(db, { title: 'Cached task' });
    const cached = getCachedTask(task.id);
    expect(cached).toBeDefined();
    expect(cached!.title).toBe('Cached task');
  });
});

describe('parallel writes (FLAKY: resource contention)', () => {
  it('should handle concurrent writes to the same database file', async () => {
    const dbPath = path.join(os.tmpdir(), `flaky-test-${Date.now()}.db`);
    const db1 = createDb(dbPath);
    const db2 = createDb(dbPath);

    try {
      const results = await Promise.all([
        Promise.resolve(createTask(db1, { title: 'From connection 1' })),
        Promise.resolve(createTask(db2, { title: 'From connection 2' })),
      ]);

      expect(results).toHaveLength(2);
      const allTasks = getTasks(db1);
      expect(allTasks).toHaveLength(2);
    } finally {
      db1.close();
      db2.close();
      fs.unlinkSync(dbPath);
    }
  });
});

describe('concurrent updates (FLAKY: shared state within single test)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createDb(':memory:');
  });

  it('should apply both updates to the same task', async () => {
    const task = createTask(db, { title: 'Original', description: 'Initial' });

    await Promise.all([
      Promise.resolve(updateTask(db, task.id, { title: 'Updated Title' })),
      Promise.resolve(updateTask(db, task.id, { status: 'done' })),
    ]);

    const result = getTask(db, task.id)!;
    expect(result.title).toBe('Updated Title');
    expect(result.status).toBe('done');
  });
});

describe('getTasksByIds (REAL FAILURE: consistent failure after refactor)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createDb(':memory:');
  });

  it('should return empty array when called with null', () => {
    const result = getTasksByIds(db, null as any);
    expect(result).toEqual([]);
  });
});

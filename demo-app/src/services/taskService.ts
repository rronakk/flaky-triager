import type Database from 'better-sqlite3';
import type { Task, CreateTaskInput, UpdateTaskInput, TaskStats } from '../types.js';

export function createTask(db: Database.Database, input: CreateTaskInput): Task {
  const stmt = db.prepare(
    'INSERT INTO tasks (title, description) VALUES (?, ?)'
  );
  const result = stmt.run(input.title, input.description ?? null);
  return getTask(db, result.lastInsertRowid as number)!;
}

export function getTasks(
  db: Database.Database,
  filter?: { status?: string }
): Task[] {
  if (filter?.status) {
    return db.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC').all(filter.status) as Task[];
  }
  return db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all() as Task[];
}

export function getTask(db: Database.Database, id: number): Task | undefined {
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Task | undefined;
}

export function updateTask(
  db: Database.Database,
  id: number,
  input: UpdateTaskInput
): Task {
  const task = getTask(db, id);
  if (!task) throw new Error(`Task ${id} not found`);

  const updated = {
    title: input.title ?? task.title,
    description: input.description ?? task.description,
    status: input.status ?? task.status,
  };

  db.prepare(
    "UPDATE tasks SET title = ?, description = ?, status = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(updated.title, updated.description, updated.status, id);

  return getTask(db, id)!;
}

export function deleteTask(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
}

export function getStats(db: Database.Database): TaskStats {
  const total = (db.prepare('SELECT COUNT(*) as count FROM tasks').get() as any).count;
  const done = (db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'done'").get() as any).count;
  const pending = total - done;
  const completionPercentage = total === 0 ? 0 : (done / total) * 100;
  return { total, pending, done, completionPercentage };
}

const taskCache = new Map<number, Task>();

export async function createTaskWithCache(
  db: Database.Database,
  input: CreateTaskInput
): Promise<Task> {
  const task = createTask(db, input);
  updateCache(task);
  return task;
}

async function updateCache(task: Task): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, Math.random() * 50));
  taskCache.set(task.id, task);
}

export function getCachedTask(id: number): Task | undefined {
  return taskCache.get(id);
}

export function clearCache(): void {
  taskCache.clear();
}

export function filterTasks(tasks: Task[], filter: { status: string }): Task[] {
  return tasks.filter((t) => t.status != filter.status);
}

export function getTasksByIds(db: Database.Database, ids: number[]): Task[] {
  if (ids === null || ids === undefined) {
    throw new Error('ids parameter is required');
  }
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  return db.prepare(`SELECT * FROM tasks WHERE id IN (${placeholders})`).all(...ids) as Task[];
}

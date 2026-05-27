# Flaky Test Triage Agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CI flakiness triage agent that detects flaky vs real test failures, explains root causes via LLM, and quarantines flaky tests with human confirmation.

**Architecture:** Two-repo structure. `flaky-demo-app` is a task management app with planted flaky/real test failures used to validate the agent. `flaky-triager` is the agent itself — a TypeScript library with CLI, GitHub Action, and Cloud Run delivery layers. Core principle: stats decide (deterministic scoring), LLM explains (root-cause analysis).

**Tech Stack:** TypeScript, Express, SQLite (better-sqlite3), React, Vitest, Playwright, Claude API (swappable), Firestore, GitHub Actions, Cloud Run.

**Spec:** See `docs/design-spec.md` for full architectural decisions and rationale.

---

## File Structure

### `flaky-demo-app` (separate repo — Phases 1-2)

```
flaky-demo-app/
  package.json
  tsconfig.json
  vitest.workspace.ts
  playwright.config.ts
  vite.config.ts
  .gitignore
  .github/
    workflows/
      ci.yml
  src/
    types.ts                    — Task type + shared interfaces
    db.ts                       — SQLite connection + schema init
    app.ts                      — Express app (exported for testing)
    server.ts                   — Entry point (starts server)
    routes/
      tasks.ts                  — Task CRUD route handlers
    services/
      taskService.ts            — Business logic (CRUD, stats)
    utils/
      validation.ts             — Input validation (title, status)
      formatting.ts             — Display formatting helpers
      stats.ts                  — Completion percentage, overdue check
  client/
    index.html                  — Vite entry point
    src/
      main.tsx                  — React mount
      App.tsx                   — Single-page task management UI
  tests/
    unit/
      validation.test.ts        — 4 tests
      formatting.test.ts        — 3 tests
      stats.test.ts             — 4 tests
    integration/
      taskService.test.ts       — 6 tests
    api/
      tasks.test.ts             — 5 tests
    e2e/
      tasks.spec.ts             — 4 tests
  test-results/                 — JUnit XML output (gitignored)
```

### `flaky-triager` (this repo — Phases 3-9)

```
flaky-triager/
  package.json
  tsconfig.json
  vitest.config.ts
  docs/
    design-spec.md
    plans/
      implementation-plan.md
  src/
    types.ts                    — Shared types (TestResult, ScoredResult, Analysis)
    parser/
      index.ts                  — JUnit XML parser
      xmlTypes.ts               — Raw XML type mappings
    scorer/
      index.ts                  — Flakiness scorer (deterministic)
    analyzer/
      index.ts                  — LLM analysis orchestrator
      prompt.ts                 — Prompt templates
      providers/
        claude.ts               — Claude API provider
        types.ts                — LLM provider interface
    reporter/
      index.ts                  — Output formatter
      formats/
        cli.ts                  — CLI text output
        markdown.ts             — PR comment markdown
        json.ts                 — JSON output
    cli.ts                      — CLI entry point
  tests/
    fixtures/                   — Sample JUnit XML files for testing
      flaky-retry-pass.xml
      all-pass.xml
      real-failure.xml
      mixed-results.xml
    parser/
      parser.test.ts
    scorer/
      scorer.test.ts
    analyzer/
      analyzer.test.ts
    reporter/
      reporter.test.ts
```

---

# Phase 1: Demo Repo — App Scaffold + CI

**Repo:** `flaky-demo-app` (new repo, created separately)
**Goal:** Working task management app with 26 healthy passing tests and CI producing JUnit XML.
**Time estimate:** One 2-3 hour sitting.

---

### Task 1.1: Project Initialization

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`

- [ ] **Step 1: Initialize the repo**

```bash
mkdir flaky-demo-app && cd flaky-demo-app
git init
npm init -y
```

- [ ] **Step 2: Install dependencies**

```bash
# Runtime
npm install express better-sqlite3 cors

# Dev — TypeScript
npm install -D typescript @types/node @types/express @types/better-sqlite3 @types/cors tsx

# Dev — Testing
npm install -D vitest supertest @types/supertest @playwright/test

# Dev — Frontend
npm install -D vite @vitejs/plugin-react react react-dom @types/react @types/react-dom
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "dist",
    "rootDir": ".",
    "jsx": "react-jsx",
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*", "client/**/*", "tests/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Create .gitignore**

```
node_modules/
dist/
test-results/
playwright-report/
*.db
```

- [ ] **Step 5: Create vitest workspace config**

Create `vitest.workspace.ts`:

```typescript
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      name: 'unit',
      include: ['tests/unit/**/*.test.ts'],
      reporters: ['default', ['junit', { outputFile: 'test-results/junit-unit.xml' }]],
    },
  },
  {
    test: {
      name: 'integration',
      include: ['tests/integration/**/*.test.ts'],
      reporters: ['default', ['junit', { outputFile: 'test-results/junit-integration.xml' }]],
    },
  },
  {
    test: {
      name: 'api',
      include: ['tests/api/**/*.test.ts'],
      reporters: ['default', ['junit', { outputFile: 'test-results/junit-api.xml' }]],
    },
  },
]);
```

- [ ] **Step 6: Create playwright config**

Create `playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  reporter: [['list'], ['junit', { outputFile: 'test-results/junit-e2e.xml' }]],
  use: {
    baseURL: 'http://localhost:3000',
  },
  webServer: {
    command: 'npm run build:client && npm run start',
    port: 3000,
    reuseExistingServer: true,
  },
});
```

- [ ] **Step 7: Add scripts to package.json**

Update the `scripts` section:

```json
{
  "type": "module",
  "scripts": {
    "dev:server": "tsx watch src/server.ts",
    "dev:client": "vite client",
    "build:client": "vite build",
    "start": "tsx src/server.ts",
    "test:unit": "vitest run --project unit",
    "test:integration": "vitest run --project integration",
    "test:api": "vitest run --project api",
    "test:e2e": "npx playwright test",
    "test": "vitest run && npx playwright test"
  }
}
```

- [ ] **Step 8: Install Playwright browsers**

```bash
npx playwright install --with-deps chromium
```

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: initialize project with TypeScript, Vitest, Playwright"
```

---

### Task 1.2: Types + Database Layer

**Files:**
- Create: `src/types.ts`, `src/db.ts`

- [ ] **Step 1: Define the Task type**

Create `src/types.ts`:

```typescript
export interface Task {
  id: number;
  title: string;
  description: string | null;
  status: 'pending' | 'done';
  created_at: string;
  updated_at: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: 'pending' | 'done';
}

export interface TaskStats {
  total: number;
  pending: number;
  done: number;
  completionPercentage: number;
}
```

- [ ] **Step 2: Implement the database layer**

Create `src/db.ts`:

```typescript
import Database from 'better-sqlite3';

export function createDb(path: string = ':memory:'): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  return db;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/types.ts src/db.ts
git commit -m "feat: add Task types and SQLite database layer"
```

---

### Task 1.3: Service Layer (TDD)

**Files:**
- Create: `src/services/taskService.ts`
- Test: `tests/integration/taskService.test.ts`

- [ ] **Step 1: Write the failing integration tests**

Create `tests/integration/taskService.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createDb } from '../../src/db.js';
import {
  createTask,
  getTasks,
  getTask,
  updateTask,
  deleteTask,
  getStats,
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run --project integration
```

Expected: FAIL — `taskService.js` module not found.

- [ ] **Step 3: Implement the service layer**

Create `src/services/taskService.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run --project integration
```

Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/taskService.ts tests/integration/taskService.test.ts
git commit -m "feat: add task service layer with CRUD and stats"
```

---

### Task 1.4: Utility Functions (TDD)

**Files:**
- Create: `src/utils/validation.ts`, `src/utils/formatting.ts`, `src/utils/stats.ts`
- Test: `tests/unit/validation.test.ts`, `tests/unit/formatting.test.ts`, `tests/unit/stats.test.ts`

- [ ] **Step 1: Write failing validation tests**

Create `tests/unit/validation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { validateCreateInput, validateUpdateInput } from '../../src/utils/validation.js';

describe('validateCreateInput', () => {
  it('returns valid for a proper title', () => {
    const result = validateCreateInput({ title: 'Buy groceries' });
    expect(result.valid).toBe(true);
  });

  it('rejects empty title', () => {
    const result = validateCreateInput({ title: '' });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('title');
  });

  it('rejects title over 200 characters', () => {
    const result = validateCreateInput({ title: 'a'.repeat(201) });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('200');
  });

  it('accepts optional description', () => {
    const result = validateCreateInput({ title: 'Task', description: 'Details here' });
    expect(result.valid).toBe(true);
  });
});

describe('validateUpdateInput', () => {
  it('rejects invalid status value', () => {
    const result = validateUpdateInput({ status: 'invalid' as any });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('status');
  });

  it('accepts valid status values', () => {
    expect(validateUpdateInput({ status: 'pending' }).valid).toBe(true);
    expect(validateUpdateInput({ status: 'done' }).valid).toBe(true);
  });
});
```

- [ ] **Step 2: Write failing formatting tests**

Create `tests/unit/formatting.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { formatTaskForDisplay } from '../../src/utils/formatting.js';
import type { Task } from '../../src/types.js';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 1,
  title: 'Test task',
  description: null,
  status: 'pending',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('formatTaskForDisplay', () => {
  it('formats a pending task with checkbox', () => {
    const result = formatTaskForDisplay(makeTask());
    expect(result).toContain('[ ]');
    expect(result).toContain('Test task');
  });

  it('formats a done task with checkmark', () => {
    const result = formatTaskForDisplay(makeTask({ status: 'done' }));
    expect(result).toContain('[x]');
  });

  it('includes description when present', () => {
    const result = formatTaskForDisplay(makeTask({ description: 'Some details' }));
    expect(result).toContain('Some details');
  });
});
```

- [ ] **Step 3: Write failing stats tests**

Create `tests/unit/stats.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  getCompletionPercentage,
  isOverdue,
} from '../../src/utils/stats.js';

describe('getCompletionPercentage', () => {
  it('calculates percentage with some done', () => {
    expect(getCompletionPercentage(3, 10)).toBeCloseTo(30, 1);
  });

  it('returns 0 when none done', () => {
    expect(getCompletionPercentage(0, 5)).toBe(0);
  });

  it('returns 100 when all done', () => {
    expect(getCompletionPercentage(5, 5)).toBe(100);
  });

  it('returns 0 when total is zero', () => {
    expect(getCompletionPercentage(0, 0)).toBe(0);
  });
});

describe('isOverdue', () => {
  it('returns true when task is past due', () => {
    const pastDate = new Date(Date.now() - 60_000).toISOString();
    expect(isOverdue(pastDate, 30_000)).toBe(true);
  });

  it('returns false when task is not yet due', () => {
    const recentDate = new Date().toISOString();
    expect(isOverdue(recentDate, 60_000)).toBe(false);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

```bash
npx vitest run --project unit
```

Expected: FAIL — modules not found.

- [ ] **Step 5: Implement validation.ts**

Create `src/utils/validation.ts`:

```typescript
import type { CreateTaskInput, UpdateTaskInput } from '../types.js';

interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateCreateInput(input: CreateTaskInput): ValidationResult {
  if (!input.title || input.title.trim().length === 0) {
    return { valid: false, error: 'title is required' };
  }
  if (input.title.length > 200) {
    return { valid: false, error: 'title must be 200 characters or fewer' };
  }
  return { valid: true };
}

export function validateUpdateInput(input: UpdateTaskInput): ValidationResult {
  if (input.status && !['pending', 'done'].includes(input.status)) {
    return { valid: false, error: 'status must be "pending" or "done"' };
  }
  return { valid: true };
}
```

- [ ] **Step 6: Implement formatting.ts**

Create `src/utils/formatting.ts`:

```typescript
import type { Task } from '../types.js';

export function formatTaskForDisplay(task: Task): string {
  const checkbox = task.status === 'done' ? '[x]' : '[ ]';
  const desc = task.description ? ` — ${task.description}` : '';
  return `${checkbox} ${task.title}${desc}`;
}
```

- [ ] **Step 7: Implement stats.ts**

Create `src/utils/stats.ts`:

```typescript
export function getCompletionPercentage(done: number, total: number): number {
  if (total === 0) return 0;
  return (done / total) * 100;
}

export function isOverdue(createdAt: string, dueInMs: number): boolean {
  const created = new Date(createdAt).getTime();
  return Date.now() > created + dueInMs;
}
```

- [ ] **Step 8: Run tests to verify they pass**

```bash
npx vitest run --project unit
```

Expected: 11 tests PASS.

- [ ] **Step 9: Commit**

```bash
git add src/utils/ tests/unit/
git commit -m "feat: add validation, formatting, and stats utilities"
```

---

### Task 1.5: Express API (TDD)

**Files:**
- Create: `src/app.ts`, `src/routes/tasks.ts`, `src/server.ts`
- Test: `tests/api/tasks.test.ts`

- [ ] **Step 1: Write failing API tests**

Create `tests/api/tasks.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../src/app.js';
import { createDb } from '../../src/db.js';

describe('Tasks API', () => {
  let request: supertest.SuperTest<supertest.Test>;

  beforeEach(() => {
    const db = createDb(':memory:');
    const app = createApp(db);
    request = supertest(app);
  });

  it('GET /tasks returns empty array initially', async () => {
    const res = await request.get('/tasks');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('POST /tasks creates a task', async () => {
    const res = await request
      .post('/tasks')
      .send({ title: 'New task', description: 'Details' });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('New task');
    expect(res.body.status).toBe('pending');
  });

  it('PATCH /tasks/:id updates a task', async () => {
    const created = await request.post('/tasks').send({ title: 'Task' });
    const res = await request
      .patch(`/tasks/${created.body.id}`)
      .send({ status: 'done' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('done');
  });

  it('DELETE /tasks/:id removes a task', async () => {
    const created = await request.post('/tasks').send({ title: 'Task' });
    const delRes = await request.delete(`/tasks/${created.body.id}`);
    expect(delRes.status).toBe(204);

    const listRes = await request.get('/tasks');
    expect(listRes.body).toHaveLength(0);
  });

  it('GET /tasks/stats returns correct counts', async () => {
    await request.post('/tasks').send({ title: 'Task 1' });
    await request.post('/tasks').send({ title: 'Task 2' });
    const created = await request.post('/tasks').send({ title: 'Task 3' });
    await request.patch(`/tasks/${created.body.id}`).send({ status: 'done' });

    const res = await request.get('/tasks/stats');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.done).toBe(1);
    expect(res.body.pending).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run --project api
```

Expected: FAIL — `app.js` module not found.

- [ ] **Step 3: Implement routes**

Create `src/routes/tasks.ts`:

```typescript
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

  return router;
}
```

- [ ] **Step 4: Implement Express app**

Create `src/app.ts`:

```typescript
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

  // Serve built frontend in production
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });

  return app;
}
```

- [ ] **Step 5: Create server entry point**

Create `src/server.ts`:

```typescript
import { createDb } from './db.js';
import { createApp } from './app.js';

const db = createDb('tasks.db');
const app = createApp(db);
const port = process.env.PORT ?? 3000;

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npx vitest run --project api
```

Expected: 5 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app.ts src/routes/tasks.ts src/server.ts tests/api/tasks.test.ts
git commit -m "feat: add Express API with task CRUD endpoints"
```

---

### Task 1.6: React Frontend

**Files:**
- Create: `client/index.html`, `client/src/main.tsx`, `client/src/App.tsx`, `vite.config.ts`

- [ ] **Step 1: Create Vite config**

Create `vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: 'client',
  build: {
    outDir: 'dist',
  },
  server: {
    proxy: {
      '/tasks': 'http://localhost:3000',
    },
  },
});
```

- [ ] **Step 2: Create HTML entry point**

Create `client/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Task Manager</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
    .stats-bar { background: #f0f0f0; padding: 12px; border-radius: 8px; margin-bottom: 20px; display: flex; gap: 16px; }
    .stat { font-size: 14px; }
    .stat strong { font-size: 18px; }
    form { display: flex; gap: 8px; margin-bottom: 20px; }
    input[type="text"] { flex: 1; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; }
    button { padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; }
    button[type="submit"] { background: #0066ff; color: white; }
    .task-list { list-style: none; }
    .task-item { display: flex; align-items: center; gap: 8px; padding: 12px 0; border-bottom: 1px solid #eee; }
    .task-item.done .task-title { text-decoration: line-through; color: #999; }
    .task-title { flex: 1; }
    .delete-btn { background: none; color: #cc0000; border: 1px solid #cc0000; font-size: 12px; padding: 4px 8px; }
    .empty-state { text-align: center; color: #999; padding: 40px 0; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

- [ ] **Step 3: Create React mount**

Create `client/src/main.tsx`:

```tsx
import { createRoot } from 'react-dom/client';
import { App } from './App.js';

createRoot(document.getElementById('root')!).render(<App />);
```

- [ ] **Step 4: Create App component**

Create `client/src/App.tsx`:

```tsx
import { useState, useEffect } from 'react';

interface Task {
  id: number;
  title: string;
  description: string | null;
  status: 'pending' | 'done';
}

interface Stats {
  total: number;
  pending: number;
  done: number;
  completionPercentage: number;
}

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, pending: 0, done: 0, completionPercentage: 0 });
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);

  async function fetchData() {
    const [tasksRes, statsRes] = await Promise.all([
      fetch('/tasks'),
      fetch('/tasks/stats'),
    ]);
    setTasks(await tasksRes.json());
    setStats(await statsRes.json());
    setLoading(false);
  }

  useEffect(() => { fetchData(); }, []);

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await fetch('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    setTitle('');
    fetchData();
  }

  async function toggleStatus(task: Task) {
    await fetch(`/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: task.status === 'pending' ? 'done' : 'pending' }),
    });
    fetchData();
  }

  async function removeTask(id: number) {
    await fetch(`/tasks/${id}`, { method: 'DELETE' });
    fetchData();
  }

  if (loading) return <p>Loading...</p>;

  return (
    <div>
      <h1>Task Manager</h1>

      <div className="stats-bar" data-testid="stats-bar">
        <div className="stat"><strong>{stats.total}</strong> total</div>
        <div className="stat"><strong>{stats.pending}</strong> pending</div>
        <div className="stat"><strong>{stats.done}</strong> done</div>
        <div className="stat"><strong>{stats.completionPercentage.toFixed(1)}%</strong> complete</div>
      </div>

      <form onSubmit={addTask} data-testid="add-task-form">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a new task..."
          data-testid="task-input"
        />
        <button type="submit" data-testid="add-task-btn">Add Task</button>
      </form>

      {tasks.length === 0 ? (
        <p className="empty-state" data-testid="empty-state">No tasks yet</p>
      ) : (
        <ul className="task-list">
          {tasks.map((task) => (
            <li key={task.id} className={`task-item ${task.status}`}>
              <input
                type="checkbox"
                checked={task.status === 'done'}
                onChange={() => toggleStatus(task)}
                data-testid={`toggle-${task.id}`}
              />
              <span className="task-title" data-testid={`task-title-${task.id}`}>
                {task.title}
              </span>
              <button
                className="delete-btn"
                onClick={() => removeTask(task.id)}
                data-testid={`delete-${task.id}`}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Verify the app runs locally**

In one terminal:
```bash
npm run dev:server
```

In another terminal:
```bash
npm run dev:client
```

Open `http://localhost:5173`, verify the UI loads and you can add/toggle/delete tasks.

- [ ] **Step 6: Commit**

```bash
git add vite.config.ts client/
git commit -m "feat: add React frontend with task management UI"
```

---

### Task 1.7: E2E Tests (Playwright)

**Files:**
- Create: `tests/e2e/tasks.spec.ts`

- [ ] **Step 1: Write E2E tests**

Create `tests/e2e/tasks.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

test.describe('Task Manager', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('shows empty state when no tasks exist', async ({ page }) => {
    await expect(page.getByTestId('empty-state')).toBeVisible();
    await expect(page.getByTestId('empty-state')).toContainText('No tasks yet');
  });

  test('adds a new task', async ({ page }) => {
    await page.getByTestId('task-input').fill('Buy groceries');
    await page.getByTestId('add-task-btn').click();

    await expect(page.getByText('Buy groceries')).toBeVisible();
    await expect(page.getByTestId('empty-state')).not.toBeVisible();
  });

  test('toggles task status', async ({ page }) => {
    await page.getByTestId('task-input').fill('Test task');
    await page.getByTestId('add-task-btn').click();
    await expect(page.getByText('Test task')).toBeVisible();

    // Find the checkbox and toggle it
    const checkbox = page.locator('.task-item input[type="checkbox"]').first();
    await checkbox.check();

    // Verify the task is marked as done
    await expect(page.locator('.task-item.done')).toBeVisible();
  });

  test('deletes a task', async ({ page }) => {
    await page.getByTestId('task-input').fill('Task to delete');
    await page.getByTestId('add-task-btn').click();
    await expect(page.getByText('Task to delete')).toBeVisible();

    await page.getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByText('Task to delete')).not.toBeVisible();
    await expect(page.getByTestId('empty-state')).toBeVisible();
  });
});
```

- [ ] **Step 2: Build frontend and run E2E tests**

```bash
npm run build:client
npm run test:e2e
```

Expected: 4 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/tasks.spec.ts
git commit -m "feat: add Playwright E2E tests for task management"
```

---

### Task 1.8: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium

      - name: Run unit tests
        run: npx vitest run --project unit

      - name: Run integration tests
        run: npx vitest run --project integration

      - name: Run API tests
        run: npx vitest run --project api

      - name: Build frontend
        run: npm run build:client

      - name: Run E2E tests
        run: npx playwright test

      - name: Upload JUnit XML results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: test-results
          path: test-results/
          retention-days: 30
```

- [ ] **Step 2: Verify all tests pass locally**

```bash
npm run test
```

Expected: 26 tests across all layers PASS. JUnit XML files appear in `test-results/`.

- [ ] **Step 3: Commit and push**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow with JUnit XML artifacts"
git remote add origin <your-github-repo-url>
git push -u origin main
```

- [ ] **Step 4: Verify CI goes green on GitHub**

Check the Actions tab in the GitHub repo. All tests should pass and `test-results/` artifact should be downloadable.

---

# Phase 2: Demo Repo — Plant Flaky + Real Failure Tests

**Repo:** `flaky-demo-app`
**Goal:** Add 14 planted test scenarios (10 flaky, 4 real failures) alongside the healthy tests. Configure retries. Verify flaky tests actually flake on CI.
**Time estimate:** One 2-3 hour sitting.

**Important:** Flaky tests must fail intermittently, not every time. Each one uses a different mechanism to produce nondeterminism. The real failures must fail consistently every run.

---

### Task 2.1: Flaky — Async Race Condition (Integration)

**Files:**
- Modify: `src/services/taskService.ts` (add async cache update method)
- Test: `tests/integration/taskService.test.ts` (add flaky test)

- [ ] **Step 1: Add an async cache-update function to the service**

Add to `src/services/taskService.ts`:

```typescript
// In-memory cache for recently accessed tasks (simulates a real caching layer)
const taskCache = new Map<number, Task>();

export async function createTaskWithCache(
  db: Database.Database,
  input: CreateTaskInput
): Promise<Task> {
  const task = createTask(db, input);
  // Fire-and-forget cache update (intentionally NOT awaited — this is the bug)
  updateCache(task);
  return task;
}

async function updateCache(task: Task): Promise<void> {
  // Simulate async cache write with variable latency
  await new Promise((resolve) => setTimeout(resolve, Math.random() * 50));
  taskCache.set(task.id, task);
}

export function getCachedTask(id: number): Task | undefined {
  return taskCache.get(id);
}

export function clearCache(): void {
  taskCache.clear();
}
```

- [ ] **Step 2: Add the flaky test**

Add to `tests/integration/taskService.test.ts`:

```typescript
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
} from '../../src/services/taskService.js';

// ... existing tests ...

describe('taskService - cache (FLAKY: async race condition)', () => {
  beforeEach(() => {
    clearCache();
  });

  it('should populate cache after creating a task', async () => {
    const task = await createTaskWithCache(db, { title: 'Cached task' });
    // BUG: reads cache immediately without awaiting the fire-and-forget update
    // Passes ~80% of the time when setTimeout resolves fast, fails when slow
    const cached = getCachedTask(task.id);
    expect(cached).toBeDefined();
    expect(cached!.title).toBe('Cached task');
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add src/services/taskService.ts tests/integration/taskService.test.ts
git commit -m "test: add async race condition flaky test (cache timing)"
```

---

### Task 2.2: Flaky — Test-Order Dependency (Unit)

**Files:**
- Modify: `src/utils/formatting.ts` (add module-level state)
- Test: `tests/unit/formatting.test.ts` (add flaky test)

- [ ] **Step 1: Add module-level display history to formatting**

Add to `src/utils/formatting.ts`:

```typescript
// Module-level state: tracks recently displayed tasks for "history" feature
export const displayHistory: string[] = [];

export function trackDisplay(task: Task): void {
  displayHistory.push(task.title);
}

export function getRecentDisplays(count: number): string[] {
  return displayHistory.slice(-count);
}
```

- [ ] **Step 2: Add the order-dependent tests**

Add to `tests/unit/formatting.test.ts`:

```typescript
import {
  formatTaskForDisplay,
  displayHistory,
  trackDisplay,
  getRecentDisplays,
} from '../../src/utils/formatting.js';

// ... existing tests ...

describe('display history (FLAKY: test-order dependency)', () => {
  // NOTE: Intentionally missing beforeEach to clear displayHistory.
  // This test passes when it runs after the test below (which populates history),
  // but fails when run in isolation or in shuffled order.

  it('should show recently displayed tasks', () => {
    // Assumes previous test already tracked 'Task A'
    const recent = getRecentDisplays(1);
    expect(recent).toContain('Task A');
  });

  it('tracks a displayed task', () => {
    trackDisplay(makeTask({ title: 'Task A' }));
    expect(displayHistory).toContain('Task A');
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add src/utils/formatting.ts tests/unit/formatting.test.ts
git commit -m "test: add test-order dependency flaky test (display history)"
```

---

### Task 2.3: Flaky — External Dependency (API)

**Files:**
- Modify: `src/routes/tasks.ts` (add webhook notification endpoint)
- Test: `tests/api/tasks.test.ts` (add flaky test)

- [ ] **Step 1: Add a webhook notification route**

Add to `src/routes/tasks.ts`:

```typescript
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
```

- [ ] **Step 2: Add the flaky test**

Add to `tests/api/tasks.test.ts`:

```typescript
describe('Webhook notification (FLAKY: external dependency)', () => {
  it('should deliver webhook notification', async () => {
    // Hits a real external URL that may be slow or unreachable
    // This makes the test flaky — it depends on network conditions
    const res = await request
      .post('/tasks/notify')
      .send({
        webhookUrl: 'https://httpbin.org/delay/1',
        taskId: 1,
      });
    expect(res.status).toBe(200);
    expect(res.body.notified).toBe(true);
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/tasks.ts tests/api/tasks.test.ts
git commit -m "test: add external dependency flaky test (webhook)"
```

---

### Task 2.4: Flaky — Resource Contention (Integration)

**Files:**
- Test: `tests/integration/taskService.test.ts` (add flaky test)

- [ ] **Step 1: Add resource contention test**

Add to `tests/integration/taskService.test.ts`:

```typescript
import path from 'path';
import os from 'os';
import fs from 'fs';

describe('parallel writes (FLAKY: resource contention)', () => {
  it('should handle concurrent writes to the same database file', async () => {
    // Two connections writing to the same file — occasionally gets SQLITE_BUSY
    const dbPath = path.join(os.tmpdir(), `flaky-test-${Date.now()}.db`);
    const db1 = createDb(dbPath);
    const db2 = createDb(dbPath);

    try {
      // Fire parallel writes from two connections
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
```

- [ ] **Step 2: Commit**

```bash
git add tests/integration/taskService.test.ts
git commit -m "test: add resource contention flaky test (parallel SQLite writes)"
```

---

### Task 2.5: Flaky — Time-Sensitive (Unit)

**Files:**
- Test: `tests/unit/stats.test.ts` (add flaky test)

- [ ] **Step 1: Add time-sensitive test**

Add to `tests/unit/stats.test.ts`:

```typescript
describe('isOverdue edge cases (FLAKY: time-sensitive)', () => {
  it('should detect a task that just became overdue', () => {
    // Creates a task "due in 5ms" — passes when assertions run fast,
    // fails when the test runner is slow (CI, heavy load)
    const justNow = new Date().toISOString();
    // Intentionally tight window — 5ms due period
    // The time between creating the date and calling isOverdue may or may not exceed 5ms
    const result = isOverdue(justNow, 5);
    expect(result).toBe(false);
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add tests/unit/stats.test.ts
git commit -m "test: add time-sensitive flaky test (tight timing window)"
```

---

### Task 2.6: Flaky — Randomness / Unseeded Data (Unit)

**Files:**
- Test: `tests/unit/validation.test.ts` (add flaky test)

- [ ] **Step 1: Install faker**

```bash
npm install -D @faker-js/faker
```

- [ ] **Step 2: Add randomness-based flaky test**

Add to `tests/unit/validation.test.ts`:

```typescript
import { faker } from '@faker-js/faker';

describe('validateCreateInput with generated data (FLAKY: randomness)', () => {
  it('should accept any reasonable task title', () => {
    // Uses faker WITHOUT a seed — occasionally generates a title > 200 chars
    // faker.lorem.sentence() can produce strings of varying lengths
    // Most of the time it's under 200 chars, but sometimes it's not
    const title = faker.lorem.sentence({ min: 3, max: 40 });
    const result = validateCreateInput({ title });
    expect(result.valid).toBe(true);
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add tests/unit/validation.test.ts package.json package-lock.json
git commit -m "test: add randomness/unseeded data flaky test (faker)"
```

---

### Task 2.7: Flaky — Concurrency / Shared State in Single Test (Integration)

**Files:**
- Test: `tests/integration/taskService.test.ts` (add flaky test)

- [ ] **Step 1: Add concurrency flaky test**

Add to `tests/integration/taskService.test.ts`:

```typescript
describe('concurrent updates (FLAKY: shared state within single test)', () => {
  it('should apply both updates to the same task', async () => {
    const task = createTask(db, { title: 'Original', description: 'Initial' });

    // Fire two updates in parallel on the same task — race condition
    await Promise.all([
      Promise.resolve(updateTask(db, task.id, { title: 'Updated Title' })),
      Promise.resolve(updateTask(db, task.id, { status: 'done' })),
    ]);

    const result = getTask(db, task.id)!;
    // Expects BOTH updates applied, but one may overwrite the other
    // because updateTask reads the current state then writes the full row
    expect(result.title).toBe('Updated Title');
    expect(result.status).toBe('done');
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add tests/integration/taskService.test.ts
git commit -m "test: add concurrency/shared-state flaky test (parallel updates)"
```

---

### Task 2.8: Flaky — Floating-Point Precision (Unit)

**Files:**
- Test: `tests/unit/stats.test.ts` (add flaky test)

- [ ] **Step 1: Add floating-point precision test**

Add to `tests/unit/stats.test.ts`:

```typescript
describe('getCompletionPercentage precision (FLAKY: floating-point)', () => {
  it('should return exactly 33.33 for 1 of 3 tasks done', () => {
    // Uses toBe (strict equality) instead of toBeCloseTo
    // (1/3)*100 = 33.33333... which sometimes rounds differently
    const result = getCompletionPercentage(1, 3);
    expect(result).toBe(33.33);
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add tests/unit/stats.test.ts
git commit -m "test: add floating-point precision flaky test"
```

---

### Task 2.9: Flaky — Element Not Always Present (E2E)

**Files:**
- Modify: `client/src/App.tsx` (add async empty-state check)
- Test: `tests/e2e/tasks.spec.ts` (add flaky test)

- [ ] **Step 1: Add async empty-state behavior to the frontend**

Modify `client/src/App.tsx` — change the empty-state rendering to include a delayed check:

Replace the empty-state section in the JSX:

```tsx
{tasks.length === 0 && !loading ? (
  <EmptyState />
) : (
```

Add the `EmptyState` component inside `App.tsx` (above the `App` function):

```tsx
function EmptyState() {
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    // Simulate an async check (e.g., syncing with server to confirm no tasks)
    const delay = Math.random() * 200; // 0-200ms random delay
    const timer = setTimeout(() => setChecked(true), delay);
    return () => clearTimeout(timer);
  }, []);

  if (!checked) return null; // Nothing rendered until async check completes
  return <p className="empty-state" data-testid="empty-state">No tasks yet</p>;
}
```

- [ ] **Step 2: Add the flaky E2E test**

Add to `tests/e2e/tasks.spec.ts`:

```typescript
test.describe('Empty state async (FLAKY: element not always present)', () => {
  test('should show empty state message immediately on load', async ({ page }) => {
    await page.goto('/');
    // Uses a very short timeout — sometimes the async EmptyState hasn't rendered yet
    const emptyState = page.getByTestId('empty-state');
    await expect(emptyState).toBeVisible({ timeout: 100 });
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add client/src/App.tsx tests/e2e/tasks.spec.ts
git commit -m "test: add element-not-always-present flaky E2E test"
```

---

### Task 2.10: Flaky — Click Before Render (E2E)

**Files:**
- Modify: `client/src/App.tsx` (add delayed form hydration)
- Test: `tests/e2e/tasks.spec.ts` (add flaky test)

- [ ] **Step 1: Add delayed form initialization**

Modify `client/src/App.tsx` — add a hydration delay to the form:

Add a `formReady` state to the `App` component:

```tsx
const [formReady, setFormReady] = useState(false);

useEffect(() => {
  // Simulate JS hydration delay (e.g., loading form validation library)
  const timer = setTimeout(() => setFormReady(true), Math.random() * 150);
  return () => clearTimeout(timer);
}, []);
```

Update the form's submit button:

```tsx
<button type="submit" data-testid="add-task-btn" disabled={!formReady}>
  Add Task
</button>
```

- [ ] **Step 2: Add the flaky E2E test**

Add to `tests/e2e/tasks.spec.ts`:

```typescript
test.describe('Form submission (FLAKY: click before render)', () => {
  test('should add task immediately after page load', async ({ page }) => {
    await page.goto('/');
    // Does NOT wait for the form to be ready — clicks immediately
    // Sometimes the button is still disabled when Playwright clicks
    await page.getByTestId('task-input').fill('Quick task');
    await page.getByTestId('add-task-btn').click({ timeout: 100 });
    await expect(page.getByText('Quick task')).toBeVisible({ timeout: 500 });
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add client/src/App.tsx tests/e2e/tasks.spec.ts
git commit -m "test: add click-before-render flaky E2E test"
```

---

### Task 2.11: Real Failure — Genuine Bug (Unit)

**Files:**
- Modify: `src/services/taskService.ts` (add buggy filter function)
- Test: `tests/unit/taskFilter.test.ts`

- [ ] **Step 1: Add a buggy filter function**

Add to `src/services/taskService.ts`:

```typescript
export function filterTasks(tasks: Task[], filter: { status: string }): Task[] {
  // BUG: uses = instead of === (loose comparison works for strings,
  // but the real bug is the inverted logic: != instead of ===)
  return tasks.filter((t) => t.status != filter.status);
}
```

- [ ] **Step 2: Write the test that catches the bug**

Create `tests/unit/taskFilter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { filterTasks } from '../../src/services/taskService.js';
import type { Task } from '../../src/types.js';

const makeTasks = (): Task[] => [
  { id: 1, title: 'Task 1', description: null, status: 'pending', created_at: '', updated_at: '' },
  { id: 2, title: 'Task 2', description: null, status: 'done', created_at: '', updated_at: '' },
  { id: 3, title: 'Task 3', description: null, status: 'pending', created_at: '', updated_at: '' },
];

describe('filterTasks (REAL FAILURE: genuine bug)', () => {
  it('should return only done tasks when filtering by done', () => {
    const tasks = makeTasks();
    const result = filterTasks(tasks, { status: 'done' });
    // Expects [Task 2], but the bug returns [Task 1, Task 3] (inverted logic)
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('done');
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails consistently**

```bash
npx vitest run --project unit tests/unit/taskFilter.test.ts
```

Expected: FAIL every run. The filter returns the wrong tasks.

- [ ] **Step 4: Commit**

```bash
git add src/services/taskService.ts tests/unit/taskFilter.test.ts
git commit -m "test: add genuine bug real-failure test (inverted filter logic)"
```

---

### Task 2.12: Real Failure — Stale Test After Code Change (API)

**Files:**
- Modify: `src/routes/tasks.ts` (change response field name)
- Test: `tests/api/tasks.test.ts` (add test with old field name)

- [ ] **Step 1: Add a completion endpoint with renamed field**

Add to `src/routes/tasks.ts`:

```typescript
  router.patch('/:id/complete', (req, res) => {
    try {
      const task = updateTask(db, Number(req.params.id), { status: 'done' });
      // Field was renamed from finishedAt to completedAt in a recent refactor
      res.json({ ...task, completedAt: new Date().toISOString() });
    } catch {
      res.status(404).json({ error: 'Task not found' });
    }
  });
```

- [ ] **Step 2: Add the stale test**

Add to `tests/api/tasks.test.ts`:

```typescript
describe('Task completion (REAL FAILURE: stale test after code change)', () => {
  it('should return finishedAt timestamp when completing a task', async () => {
    const created = await request.post('/tasks').send({ title: 'To complete' });
    const res = await request.patch(`/tasks/${created.body.id}/complete`);
    expect(res.status).toBe(200);
    // BUG: Test still checks old field name 'finishedAt' — was renamed to 'completedAt'
    expect(res.body.finishedAt).toBeDefined();
  });
});
```

- [ ] **Step 3: Run to confirm consistent failure**

```bash
npx vitest run --project api
```

Expected: FAIL every run. `finishedAt` is undefined.

- [ ] **Step 4: Commit**

```bash
git add src/routes/tasks.ts tests/api/tasks.test.ts
git commit -m "test: add stale-test real-failure (finishedAt renamed to completedAt)"
```

---

### Task 2.13: Real Failure — Consistent Failure at Specific Commit (Integration)

**Files:**
- Modify: `src/services/taskService.ts` (refactor to throw on null)
- Test: `tests/integration/taskService.test.ts` (add test)

- [ ] **Step 1: Add a function that was refactored to throw on null**

Add to `src/services/taskService.ts`:

```typescript
export function getTasksByIds(db: Database.Database, ids: number[]): Task[] {
  if (ids === null || ids === undefined) {
    // Refactored: used to return [] for null input, now throws
    // This broke callers that relied on the old lenient behavior
    throw new Error('ids parameter is required');
  }
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  return db.prepare(`SELECT * FROM tasks WHERE id IN (${placeholders})`).all(...ids) as Task[];
}
```

- [ ] **Step 2: Add the test that expects old behavior**

Add to `tests/integration/taskService.test.ts`:

```typescript
import {
  // ... existing imports ...
  getTasksByIds,
} from '../../src/services/taskService.js';

describe('getTasksByIds (REAL FAILURE: consistent failure after refactor)', () => {
  it('should return empty array when called with null', () => {
    // Old behavior: returned []. New behavior: throws.
    // This test passes before the refactor commit, fails consistently after.
    const result = getTasksByIds(db, null as any);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to confirm consistent failure**

```bash
npx vitest run --project integration
```

Expected: FAIL every run. Throws instead of returning `[]`.

- [ ] **Step 4: Commit**

```bash
git add src/services/taskService.ts tests/integration/taskService.test.ts
git commit -m "test: add consistent-failure-at-commit real-failure test (null refactor)"
```

---

### Task 2.14: Real Failure — Dependency/Version Break (Unit)

**Files:**
- Create: `src/utils/truncate.ts`
- Test: `tests/unit/truncate.test.ts`

- [ ] **Step 1: Create a truncate utility that mimics a version-broken dependency**

Create `src/utils/truncate.ts`:

```typescript
// Simulates a utility whose behavior changed in a version bump.
// "Old version" truncated at 30 chars. "New version" truncates at 20 chars.
// The app was upgraded but tests still expect old behavior.
const DEFAULT_LENGTH = 20; // Was 30 in v1.x, changed to 20 in v2.0

export function truncateText(text: string, length: number = DEFAULT_LENGTH): string {
  if (text.length <= length) return text;
  return text.slice(0, length) + '...';
}
```

- [ ] **Step 2: Write the test expecting old behavior**

Create `tests/unit/truncate.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { truncateText } from '../../src/utils/truncate.js';

describe('truncateText (REAL FAILURE: dependency version break)', () => {
  it('should truncate at 30 characters by default', () => {
    const input = 'This is a fairly long task title that needs truncation';
    const result = truncateText(input);
    // Expects old v1.x behavior (default length 30)
    // But v2.0 changed default to 20 — fails every run
    expect(result).toBe('This is a fairly long task tit...');
    expect(result.length).toBe(33); // 30 chars + '...'
  });
});
```

- [ ] **Step 3: Run to confirm consistent failure**

```bash
npx vitest run --project unit tests/unit/truncate.test.ts
```

Expected: FAIL every run. Truncates at 20 instead of 30.

- [ ] **Step 4: Commit**

```bash
git add src/utils/truncate.ts tests/unit/truncate.test.ts
git commit -m "test: add dependency version break real-failure test (truncate default)"
```

---

### Task 2.15: Configure Retries + Verify JUnit XML

**Files:**
- Modify: `vitest.workspace.ts`, `playwright.config.ts`, `.github/workflows/ci.yml`

- [ ] **Step 1: Add retries to Vitest workspace config**

Update each project in `vitest.workspace.ts` to include retries:

```typescript
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      name: 'unit',
      include: ['tests/unit/**/*.test.ts'],
      reporters: ['default', ['junit', { outputFile: 'test-results/junit-unit.xml' }]],
      retry: 2,
    },
  },
  {
    test: {
      name: 'integration',
      include: ['tests/integration/**/*.test.ts'],
      reporters: ['default', ['junit', { outputFile: 'test-results/junit-integration.xml' }]],
      retry: 2,
    },
  },
  {
    test: {
      name: 'api',
      include: ['tests/api/**/*.test.ts'],
      reporters: ['default', ['junit', { outputFile: 'test-results/junit-api.xml' }]],
      retry: 2,
    },
  },
]);
```

- [ ] **Step 2: Add retries to Playwright config**

Update `playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  retries: 2,
  reporter: [['list'], ['junit', { outputFile: 'test-results/junit-e2e.xml' }]],
  use: {
    baseURL: 'http://localhost:3000',
  },
  webServer: {
    command: 'npm run build:client && npm run start',
    port: 3000,
    reuseExistingServer: true,
  },
});
```

- [ ] **Step 3: Run all tests and verify JUnit XML captures retries**

```bash
npm run test
```

Then inspect the generated XML:

```bash
cat test-results/junit-unit.xml
```

Verify that flaky tests show retry entries in the XML. Look for `<testcase>` elements with retry indicators. The real failures should fail all retries.

- [ ] **Step 4: Update CI workflow to continue on test failure**

Update `.github/workflows/ci.yml` — change test steps to use `continue-on-error`:

```yaml
      - name: Run unit tests
        run: npx vitest run --project unit
        continue-on-error: true

      - name: Run integration tests
        run: npx vitest run --project integration
        continue-on-error: true

      - name: Run API tests
        run: npx vitest run --project api
        continue-on-error: true

      - name: Run E2E tests
        run: npx playwright test
        continue-on-error: true
```

This ensures JUnit XML artifacts are always uploaded even when tests fail.

- [ ] **Step 5: Commit**

```bash
git add vitest.workspace.ts playwright.config.ts .github/workflows/ci.yml
git commit -m "ci: configure test retries and ensure JUnit XML upload on failure"
```

---

### Task 2.16: Verify Flaky Tests Actually Flake on CI

- [ ] **Step 1: Push and trigger multiple CI runs**

```bash
git push origin main
```

- [ ] **Step 2: Trigger additional CI runs**

Create 3-5 empty commits and push to trigger multiple runs:

```bash
git commit --allow-empty -m "ci: trigger run 1" && git push
git commit --allow-empty -m "ci: trigger run 2" && git push
git commit --allow-empty -m "ci: trigger run 3" && git push
```

- [ ] **Step 3: Verify the flakiness pattern**

Check GitHub Actions runs:
- Flaky tests (#1-10) should show **intermittent** failures — passing in some runs, failing in others
- Real failure tests (#11-14) should fail **consistently** in every run
- Healthy tests should pass **consistently** in every run

Download `test-results` artifacts from multiple runs and compare. If a "flaky" test passes or fails 100% of the time, adjust its nondeterminism parameters (timing windows, random seeds, etc.).

- [ ] **Step 4: Adjust flakiness rates if needed**

If tests are too stable or too broken, tune these knobs:
- Task 2.1 (async): adjust `setTimeout` range in `updateCache`
- Task 2.5 (timing): adjust the `dueInMs` parameter (5ms)
- Task 2.6 (random): adjust faker `sentence` min/max parameters
- Task 2.9 (E2E empty state): adjust the `Math.random() * 200` delay
- Task 2.10 (E2E click): adjust the `Math.random() * 150` hydration delay

---

# Phase 3: Agent — JUnit XML Parser

**Repo:** `flaky-triager` (this repo)
**Goal:** A library that parses JUnit XML files into normalized `TestResult` objects, including retry/rerun data.
**Time estimate:** One 2-3 hour sitting.

---

### Task 3.1: Agent Project Initialization

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`

- [ ] **Step 1: Initialize the project**

```bash
cd /Users/ronak.ray/workspace/flaky-triager
npm init -y
```

- [ ] **Step 2: Install dependencies**

```bash
npm install fast-xml-parser
npm install -D typescript @types/node vitest tsx
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "dist",
    "rootDir": ".",
    "declaration": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*", "tests/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    reporters: ['default'],
  },
});
```

- [ ] **Step 5: Create .gitignore**

```
node_modules/
dist/
```

- [ ] **Step 6: Add scripts to package.json**

```json
{
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "build": "tsc",
    "parse": "tsx src/cli.ts parse",
    "score": "tsx src/cli.ts score",
    "analyze": "tsx src/cli.ts analyze"
  },
  "bin": {
    "flaky-triager": "./dist/cli.js"
  }
}
```

- [ ] **Step 7: Commit**

```bash
git init
git add -A
git commit -m "chore: initialize flaky-triager agent project"
```

---

### Task 3.2: Shared Types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Define all shared types**

Create `src/types.ts`:

```typescript
export interface TestResult {
  testName: string;
  suite: string;
  className: string;
  status: 'passed' | 'failed' | 'skipped' | 'errored';
  duration: number;
  failureMessage?: string;
  stackTrace?: string;
  retryIndex: number; // 0 = original run, 1+ = retries
  sourceFile?: string;
}

export interface TestRunSummary {
  file: string;
  timestamp?: string;
  totalTests: number;
  failures: number;
  errors: number;
  skipped: number;
  duration: number;
  results: TestResult[];
}

export type Verdict = 'flaky' | 'real_break' | 'inconclusive' | 'passing';

export interface ScoredResult {
  testName: string;
  suite: string;
  verdict: Verdict;
  flakinessScore: number; // 0-100
  sameSHADivergence: boolean;
  totalRuns: number;
  failures: number;
  passes: number;
  failureMessage?: string;
  stackTrace?: string;
}

export interface FailureContext {
  testName: string;
  suite: string;
  failureMessage: string;
  stackTrace: string;
  testSourceCode?: string;
  relevantDiff?: string;
}

export interface Analysis {
  rootCauseCategory: string;
  explanation: string;
  suggestedFix: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface TriageReport {
  timestamp: string;
  sha?: string;
  results: Array<ScoredResult & { analysis?: Analysis }>;
  summary: {
    total: number;
    flaky: number;
    realBreaks: number;
    inconclusive: number;
    passing: number;
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: add shared type definitions"
```

---

### Task 3.3: Test Fixtures

**Files:**
- Create: `tests/fixtures/all-pass.xml`, `tests/fixtures/flaky-retry-pass.xml`, `tests/fixtures/real-failure.xml`, `tests/fixtures/mixed-results.xml`

- [ ] **Step 1: Create all-pass fixture**

Create `tests/fixtures/all-pass.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="unit" tests="3" failures="0" errors="0" time="0.45">
  <testsuite name="validation" tests="2" failures="0" time="0.20">
    <testcase name="validates title is required" classname="validation" time="0.10"/>
    <testcase name="rejects empty title" classname="validation" time="0.10"/>
  </testsuite>
  <testsuite name="stats" tests="1" failures="0" time="0.25">
    <testcase name="calculates percentage" classname="stats" time="0.25"/>
  </testsuite>
</testsuites>
```

- [ ] **Step 2: Create flaky-retry-pass fixture**

Create `tests/fixtures/flaky-retry-pass.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="integration" tests="4" failures="1" errors="0" time="1.20">
  <testsuite name="taskService" tests="4" failures="1" time="1.20">
    <testcase name="creates a task" classname="taskService" time="0.10"/>
    <testcase name="should populate cache after creating a task" classname="taskService - cache" time="0.30">
      <failure message="expected undefined to be defined" type="AssertionError">
        AssertionError: expected undefined to be defined
          at tests/integration/taskService.test.ts:42:25
      </failure>
    </testcase>
    <testcase name="should populate cache after creating a task" classname="taskService - cache" time="0.25">
      <!-- Retry 1: passed -->
    </testcase>
    <testcase name="gets all tasks" classname="taskService" time="0.15"/>
  </testsuite>
</testsuites>
```

- [ ] **Step 3: Create real-failure fixture**

Create `tests/fixtures/real-failure.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="unit" tests="3" failures="1" errors="0" time="0.35">
  <testsuite name="taskFilter" tests="1" failures="1" time="0.10">
    <testcase name="should return only done tasks" classname="taskFilter" time="0.05">
      <failure message="expected 2 to be 1" type="AssertionError">
        AssertionError: expected 2 to be 1
          at tests/unit/taskFilter.test.ts:18:30
      </failure>
    </testcase>
    <testcase name="should return only done tasks" classname="taskFilter" time="0.05">
      <failure message="expected 2 to be 1" type="AssertionError">
        AssertionError: expected 2 to be 1
          at tests/unit/taskFilter.test.ts:18:30
      </failure>
    </testcase>
    <testcase name="should return only done tasks" classname="taskFilter" time="0.05">
      <failure message="expected 2 to be 1" type="AssertionError">
        AssertionError: expected 2 to be 1
          at tests/unit/taskFilter.test.ts:18:30
      </failure>
    </testcase>
  </testsuite>
  <testsuite name="validation" tests="2" failures="0" time="0.25">
    <testcase name="validates title" classname="validation" time="0.10"/>
    <testcase name="rejects empty" classname="validation" time="0.15"/>
  </testsuite>
</testsuites>
```

- [ ] **Step 4: Create mixed-results fixture**

Create `tests/fixtures/mixed-results.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="integration" tests="6" failures="2" errors="0" time="2.10">
  <testsuite name="taskService" tests="6" failures="2" time="2.10">
    <testcase name="creates a task" classname="taskService" time="0.10"/>
    <testcase name="should populate cache after creating a task" classname="taskService - cache" time="0.30">
      <failure message="expected undefined to be defined">AssertionError: expected undefined to be defined</failure>
    </testcase>
    <testcase name="should populate cache after creating a task" classname="taskService - cache" time="0.25"/>
    <testcase name="should return empty array when called with null" classname="taskService" time="0.05">
      <failure message="ids parameter is required">Error: ids parameter is required</failure>
    </testcase>
    <testcase name="should return empty array when called with null" classname="taskService" time="0.05">
      <failure message="ids parameter is required">Error: ids parameter is required</failure>
    </testcase>
    <testcase name="should return empty array when called with null" classname="taskService" time="0.05">
      <failure message="ids parameter is required">Error: ids parameter is required</failure>
    </testcase>
  </testsuite>
</testsuites>
```

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/
git commit -m "test: add JUnit XML fixtures for parser tests"
```

---

### Task 3.4: JUnit XML Parser (TDD)

**Files:**
- Create: `src/parser/index.ts`
- Test: `tests/parser/parser.test.ts`

- [ ] **Step 1: Write parser tests**

Create `tests/parser/parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseJUnitXML, parseJUnitXMLFiles } from '../../src/parser/index.js';
import { readFileSync } from 'fs';
import path from 'path';

const fixture = (name: string) =>
  readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf-8');

describe('parseJUnitXML', () => {
  it('parses an all-passing test suite', () => {
    const result = parseJUnitXML(fixture('all-pass.xml'));
    expect(result.totalTests).toBe(3);
    expect(result.failures).toBe(0);
    expect(result.results).toHaveLength(3);
    expect(result.results.every((r) => r.status === 'passed')).toBe(true);
  });

  it('parses a flaky test with retry (fail then pass)', () => {
    const result = parseJUnitXML(fixture('flaky-retry-pass.xml'));
    const cacheTests = result.results.filter(
      (r) => r.testName === 'should populate cache after creating a task'
    );
    // Should have 2 entries: original failure + retry pass
    expect(cacheTests).toHaveLength(2);
    expect(cacheTests[0].status).toBe('failed');
    expect(cacheTests[0].retryIndex).toBe(0);
    expect(cacheTests[1].status).toBe('passed');
    expect(cacheTests[1].retryIndex).toBe(1);
  });

  it('parses a real failure (fails all retries)', () => {
    const result = parseJUnitXML(fixture('real-failure.xml'));
    const filterTests = result.results.filter(
      (r) => r.testName === 'should return only done tasks'
    );
    expect(filterTests).toHaveLength(3);
    expect(filterTests.every((r) => r.status === 'failed')).toBe(true);
  });

  it('extracts failure messages and stack traces', () => {
    const result = parseJUnitXML(fixture('real-failure.xml'));
    const failed = result.results.find((r) => r.status === 'failed');
    expect(failed?.failureMessage).toContain('expected 2 to be 1');
    expect(failed?.stackTrace).toContain('taskFilter.test.ts');
  });

  it('extracts test duration', () => {
    const result = parseJUnitXML(fixture('all-pass.xml'));
    result.results.forEach((r) => {
      expect(r.duration).toBeGreaterThan(0);
    });
  });
});

describe('parseJUnitXMLFiles', () => {
  it('parses multiple XML files into a combined result', () => {
    const fixtureDir = path.join(__dirname, '..', 'fixtures');
    const results = parseJUnitXMLFiles(fixtureDir);
    expect(results.length).toBeGreaterThan(1);
    // Each file produces a TestRunSummary
    results.forEach((r) => {
      expect(r.file).toBeDefined();
      expect(r.results.length).toBeGreaterThan(0);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/parser/
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the parser**

Create `src/parser/index.ts`:

```typescript
import { XMLParser } from 'fast-xml-parser';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import type { TestResult, TestRunSummary } from '../types.js';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});

export function parseJUnitXML(xml: string, sourceFile?: string): TestRunSummary {
  const parsed = xmlParser.parse(xml);
  const testsuites = parsed.testsuites ?? parsed.testsuite;
  const results: TestResult[] = [];

  const suites = Array.isArray(testsuites.testsuite)
    ? testsuites.testsuite
    : testsuites.testsuite
    ? [testsuites.testsuite]
    : [testsuites];

  for (const suite of suites) {
    const suiteName = suite['@_name'] ?? 'unknown';
    const testcases = Array.isArray(suite.testcase)
      ? suite.testcase
      : suite.testcase
      ? [suite.testcase]
      : [];

    // Group testcases by name to detect retries
    const grouped = new Map<string, typeof testcases>();
    for (const tc of testcases) {
      const name = tc['@_name'];
      if (!grouped.has(name)) grouped.set(name, []);
      grouped.get(name)!.push(tc);
    }

    for (const [testName, attempts] of grouped) {
      attempts.forEach((tc: any, index: number) => {
        const failure = tc.failure;
        const hasFailure = failure !== undefined;

        results.push({
          testName,
          suite: suiteName,
          className: tc['@_classname'] ?? suiteName,
          status: hasFailure ? 'failed' : 'passed',
          duration: parseFloat(tc['@_time'] ?? '0'),
          failureMessage: hasFailure
            ? typeof failure === 'string'
              ? failure
              : failure['@_message'] ?? ''
            : undefined,
          stackTrace: hasFailure
            ? typeof failure === 'string'
              ? failure
              : failure['#text'] ?? failure['@_message'] ?? ''
            : undefined,
          retryIndex: index,
        });
      });
    }
  }

  return {
    file: sourceFile ?? 'unknown',
    timestamp: testsuites['@_timestamp'],
    totalTests: parseInt(testsuites['@_tests'] ?? `${results.length}`),
    failures: parseInt(testsuites['@_failures'] ?? '0'),
    errors: parseInt(testsuites['@_errors'] ?? '0'),
    skipped: parseInt(testsuites['@_skipped'] ?? '0'),
    duration: parseFloat(testsuites['@_time'] ?? '0'),
    results,
  };
}

export function parseJUnitXMLFiles(dir: string): TestRunSummary[] {
  const files = readdirSync(dir).filter((f) => f.endsWith('.xml'));
  return files.map((file) => {
    const content = readFileSync(path.join(dir, file), 'utf-8');
    return parseJUnitXML(content, file);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/parser/
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/parser/ tests/parser/
git commit -m "feat: add JUnit XML parser with retry detection"
```

---

### Task 3.5: CLI Entry Point (parse command)

**Files:**
- Create: `src/cli.ts`

- [ ] **Step 1: Create CLI with parse command**

Create `src/cli.ts`:

```typescript
import { parseJUnitXMLFiles } from './parser/index.js';

const [command, ...args] = process.argv.slice(2);

if (command === 'parse') {
  const dir = args[0];
  if (!dir) {
    console.error('Usage: flaky-triager parse <directory>');
    process.exit(1);
  }
  const summaries = parseJUnitXMLFiles(dir);
  for (const summary of summaries) {
    console.log(`\n--- ${summary.file} ---`);
    console.log(`Tests: ${summary.totalTests} | Failures: ${summary.failures} | Duration: ${summary.duration}s`);
    for (const result of summary.results) {
      const icon = result.status === 'passed' ? 'PASS' : 'FAIL';
      const retry = result.retryIndex > 0 ? ` (retry ${result.retryIndex})` : '';
      console.log(`  ${icon} ${result.suite} > ${result.testName}${retry}`);
      if (result.failureMessage) {
        console.log(`       ${result.failureMessage}`);
      }
    }
  }
} else {
  console.log('Usage: flaky-triager <parse|score|analyze> <directory>');
}
```

- [ ] **Step 2: Test the CLI against fixtures**

```bash
npx tsx src/cli.ts parse tests/fixtures/
```

Expected: Prints parsed results for all fixture XML files, showing PASS/FAIL status, retry indicators, and failure messages.

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add CLI entry point with parse command"
```

---

# Phase 4: Agent — Flakiness Scorer

**Repo:** `flaky-triager`
**Goal:** Deterministic scoring module that takes parsed test results and produces flakiness verdicts based on retry patterns.
**Time estimate:** One 2-3 hour sitting.

---

### Task 4.1: Scorer (TDD)

**Files:**
- Create: `src/scorer/index.ts`
- Test: `tests/scorer/scorer.test.ts`

- [ ] **Step 1: Write scorer tests**

Create `tests/scorer/scorer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { scoreTestResults } from '../../src/scorer/index.js';
import type { TestResult } from '../../src/types.js';

function makeResult(overrides: Partial<TestResult> = {}): TestResult {
  return {
    testName: 'test',
    suite: 'suite',
    className: 'class',
    status: 'passed',
    duration: 0.1,
    retryIndex: 0,
    ...overrides,
  };
}

describe('scoreTestResults', () => {
  it('marks a test as passing when it passes on first run', () => {
    const results = [makeResult({ testName: 'always passes', status: 'passed' })];
    const scored = scoreTestResults(results);
    expect(scored).toHaveLength(1);
    expect(scored[0].verdict).toBe('passing');
    expect(scored[0].flakinessScore).toBe(0);
  });

  it('marks a test as flaky when it fails then passes on retry (same SHA)', () => {
    const results = [
      makeResult({ testName: 'flaky test', status: 'failed', retryIndex: 0, failureMessage: 'timeout' }),
      makeResult({ testName: 'flaky test', status: 'passed', retryIndex: 1 }),
    ];
    const scored = scoreTestResults(results);
    expect(scored).toHaveLength(1);
    expect(scored[0].verdict).toBe('flaky');
    expect(scored[0].sameSHADivergence).toBe(true);
    expect(scored[0].flakinessScore).toBeGreaterThan(70);
  });

  it('marks a test as inconclusive when it fails all retries', () => {
    const results = [
      makeResult({ testName: 'broken test', status: 'failed', retryIndex: 0, failureMessage: 'error' }),
      makeResult({ testName: 'broken test', status: 'failed', retryIndex: 1, failureMessage: 'error' }),
      makeResult({ testName: 'broken test', status: 'failed', retryIndex: 2, failureMessage: 'error' }),
    ];
    const scored = scoreTestResults(results);
    expect(scored).toHaveLength(1);
    expect(scored[0].verdict).toBe('inconclusive');
    expect(scored[0].sameSHADivergence).toBe(false);
  });

  it('handles multiple tests in a single run', () => {
    const results = [
      makeResult({ testName: 'good test', status: 'passed', suite: 'a' }),
      makeResult({ testName: 'flaky test', status: 'failed', suite: 'b', retryIndex: 0 }),
      makeResult({ testName: 'flaky test', status: 'passed', suite: 'b', retryIndex: 1 }),
      makeResult({ testName: 'broken test', status: 'failed', suite: 'c', retryIndex: 0 }),
      makeResult({ testName: 'broken test', status: 'failed', suite: 'c', retryIndex: 1 }),
    ];
    const scored = scoreTestResults(results);
    expect(scored).toHaveLength(3);
    expect(scored.find((s) => s.testName === 'good test')?.verdict).toBe('passing');
    expect(scored.find((s) => s.testName === 'flaky test')?.verdict).toBe('flaky');
    expect(scored.find((s) => s.testName === 'broken test')?.verdict).toBe('inconclusive');
  });

  it('only reports failed tests (not passing tests) in scored output', () => {
    const results = [
      makeResult({ testName: 'good test', status: 'passed' }),
      makeResult({ testName: 'flaky test', status: 'failed', retryIndex: 0 }),
      makeResult({ testName: 'flaky test', status: 'passed', retryIndex: 1 }),
    ];
    const scored = scoreTestResults(results);
    // Passing tests are included but with score 0 and verdict 'passing'
    const passing = scored.filter((s) => s.verdict === 'passing');
    const flaky = scored.filter((s) => s.verdict === 'flaky');
    expect(passing).toHaveLength(1);
    expect(flaky).toHaveLength(1);
  });

  it('preserves failure message from the first failure', () => {
    const results = [
      makeResult({ testName: 'test', status: 'failed', retryIndex: 0, failureMessage: 'first error', stackTrace: 'at line 5' }),
      makeResult({ testName: 'test', status: 'passed', retryIndex: 1 }),
    ];
    const scored = scoreTestResults(results);
    expect(scored[0].failureMessage).toBe('first error');
    expect(scored[0].stackTrace).toBe('at line 5');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/scorer/
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the scorer**

Create `src/scorer/index.ts`:

```typescript
import type { TestResult, ScoredResult, Verdict } from '../types.js';

export function scoreTestResults(results: TestResult[]): ScoredResult[] {
  // Group results by test name + suite
  const grouped = new Map<string, TestResult[]>();
  for (const result of results) {
    const key = `${result.suite}::${result.testName}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(result);
  }

  const scored: ScoredResult[] = [];

  for (const [, attempts] of grouped) {
    const sorted = [...attempts].sort((a, b) => a.retryIndex - b.retryIndex);
    const failures = sorted.filter((a) => a.status === 'failed');
    const passes = sorted.filter((a) => a.status === 'passed');
    const hasFailed = failures.length > 0;
    const hasPassed = passes.length > 0;
    const sameSHADivergence = hasFailed && hasPassed;

    let verdict: Verdict;
    let flakinessScore: number;

    if (!hasFailed) {
      verdict = 'passing';
      flakinessScore = 0;
    } else if (sameSHADivergence) {
      verdict = 'flaky';
      // Score based on failure ratio: more failures = more flaky evidence
      const failureRatio = failures.length / sorted.length;
      flakinessScore = Math.round(70 + (1 - failureRatio) * 30);
    } else {
      // Failed all attempts — can't distinguish stubborn flake from real break without history
      verdict = 'inconclusive';
      flakinessScore = 20;
    }

    const firstFailure = failures[0];
    scored.push({
      testName: sorted[0].testName,
      suite: sorted[0].suite,
      verdict,
      flakinessScore,
      sameSHADivergence,
      totalRuns: sorted.length,
      failures: failures.length,
      passes: passes.length,
      failureMessage: firstFailure?.failureMessage,
      stackTrace: firstFailure?.stackTrace,
    });
  }

  return scored;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/scorer/
```

Expected: All tests PASS.

- [ ] **Step 5: Add score command to CLI**

Update `src/cli.ts` — add the `score` command after the `parse` block:

```typescript
import { scoreTestResults } from './scorer/index.js';

// ... existing parse command ...

if (command === 'score') {
  const dir = args[0];
  if (!dir) {
    console.error('Usage: flaky-triager score <directory>');
    process.exit(1);
  }
  const summaries = parseJUnitXMLFiles(dir);
  const allResults = summaries.flatMap((s) => s.results);
  const scored = scoreTestResults(allResults);

  for (const s of scored) {
    const icon = { passing: 'PASS', flaky: 'FLKY', real_break: 'BREAK', inconclusive: '????' }[s.verdict];
    console.log(`  ${icon} [${s.flakinessScore}] ${s.suite} > ${s.testName} (${s.verdict})`);
    if (s.failureMessage) {
      console.log(`       ${s.failureMessage}`);
    }
  }

  const flaky = scored.filter((s) => s.verdict === 'flaky').length;
  const inconclusive = scored.filter((s) => s.verdict === 'inconclusive').length;
  console.log(`\nSummary: ${scored.length} tests | ${flaky} flaky | ${inconclusive} inconclusive`);
}
```

- [ ] **Step 6: Test CLI against fixtures**

```bash
npx tsx src/cli.ts score tests/fixtures/
```

Expected: Prints scored results showing `FLKY` for the cache test and `????` for the filter test.

- [ ] **Step 7: Commit**

```bash
git add src/scorer/ src/cli.ts tests/scorer/
git commit -m "feat: add flakiness scorer with same-SHA divergence detection"
```

---

# Phase 5: Agent — LLM Analyzer

**Repo:** `flaky-triager`
**Goal:** LLM-agnostic analysis module that sends failure context to an LLM and returns root-cause explanations.
**Time estimate:** One 2-3 hour sitting.

---

### Task 5.1: LLM Provider Interface

**Files:**
- Create: `src/analyzer/providers/types.ts`, `src/analyzer/providers/claude.ts`

- [ ] **Step 1: Install Anthropic SDK**

```bash
npm install @anthropic-ai/sdk
```

- [ ] **Step 2: Define the provider interface**

Create `src/analyzer/providers/types.ts`:

```typescript
import type { FailureContext, Analysis } from '../../types.js';

export interface LLMProvider {
  name: string;
  analyze(context: FailureContext): Promise<Analysis>;
}
```

- [ ] **Step 3: Implement the Claude provider**

Create `src/analyzer/providers/claude.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider } from './types.js';
import type { FailureContext, Analysis } from '../../types.js';
import { buildPrompt } from '../prompt.js';

export function createClaudeProvider(apiKey?: string): LLMProvider {
  const client = new Anthropic({ apiKey });

  return {
    name: 'claude',
    async analyze(context: FailureContext): Promise<Analysis> {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [
          { role: 'user', content: buildPrompt(context) },
        ],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      return parseAnalysisResponse(text);
    },
  };
}

function parseAnalysisResponse(text: string): Analysis {
  try {
    // Try to parse as JSON first (if the model returns structured output)
    const json = JSON.parse(text);
    return {
      rootCauseCategory: json.rootCauseCategory ?? 'unknown',
      explanation: json.explanation ?? text,
      suggestedFix: json.suggestedFix ?? '',
      confidence: json.confidence ?? 'medium',
    };
  } catch {
    // Fallback: treat the whole response as the explanation
    return {
      rootCauseCategory: 'unknown',
      explanation: text,
      suggestedFix: '',
      confidence: 'medium',
    };
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/analyzer/providers/
git commit -m "feat: add LLM provider interface and Claude implementation"
```

---

### Task 5.2: Prompt Engineering

**Files:**
- Create: `src/analyzer/prompt.ts`

- [ ] **Step 1: Create the prompt template**

Create `src/analyzer/prompt.ts`:

```typescript
import type { FailureContext } from '../types.js';

export function buildPrompt(context: FailureContext): string {
  return `You are an expert test reliability engineer analyzing a failing test. Determine the root cause and classify it.

## Test Information
- **Test:** ${context.testName}
- **Suite:** ${context.suite}

## Failure Message
\`\`\`
${context.failureMessage}
\`\`\`

## Stack Trace
\`\`\`
${context.stackTrace}
\`\`\`

${context.testSourceCode ? `## Test Source Code\n\`\`\`typescript\n${context.testSourceCode}\n\`\`\`\n` : ''}
${context.relevantDiff ? `## Recent Code Changes\n\`\`\`diff\n${context.relevantDiff}\n\`\`\`\n` : ''}

## Instructions
Analyze this test failure and respond with ONLY a JSON object (no markdown, no explanation outside the JSON):

{
  "rootCauseCategory": "<one of: race_condition, test_order_dependency, external_dependency, resource_contention, time_sensitive, random_data, concurrency, floating_point, ui_timing, genuine_bug, stale_test, dependency_break, unknown>",
  "explanation": "<2-3 sentence human-readable explanation of WHY this test failed and what the root cause is>",
  "suggestedFix": "<1-2 sentence concrete suggestion for fixing this test>",
  "confidence": "<high|medium|low>"
}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/analyzer/prompt.ts
git commit -m "feat: add analysis prompt template"
```

---

### Task 5.3: Analyzer Orchestrator (TDD)

**Files:**
- Create: `src/analyzer/index.ts`
- Test: `tests/analyzer/analyzer.test.ts`

- [ ] **Step 1: Write analyzer tests (with mock provider)**

Create `tests/analyzer/analyzer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { analyzeFailures } from '../../src/analyzer/index.js';
import type { ScoredResult } from '../../src/types.js';
import type { LLMProvider } from '../../src/analyzer/providers/types.js';

const mockProvider: LLMProvider = {
  name: 'mock',
  async analyze(context) {
    return {
      rootCauseCategory: 'race_condition',
      explanation: `Mock analysis for ${context.testName}`,
      suggestedFix: 'Add await',
      confidence: 'high' as const,
    };
  },
};

function makeScoredResult(overrides: Partial<ScoredResult> = {}): ScoredResult {
  return {
    testName: 'test',
    suite: 'suite',
    verdict: 'flaky',
    flakinessScore: 85,
    sameSHADivergence: true,
    totalRuns: 3,
    failures: 1,
    passes: 2,
    failureMessage: 'expected undefined to be defined',
    stackTrace: 'at test.ts:42',
    ...overrides,
  };
}

describe('analyzeFailures', () => {
  it('analyzes flaky tests and returns results with analysis', async () => {
    const scored = [makeScoredResult({ testName: 'flaky test', verdict: 'flaky' })];
    const results = await analyzeFailures(scored, mockProvider);
    expect(results).toHaveLength(1);
    expect(results[0].analysis).toBeDefined();
    expect(results[0].analysis!.rootCauseCategory).toBe('race_condition');
  });

  it('analyzes inconclusive tests', async () => {
    const scored = [makeScoredResult({ testName: 'unknown test', verdict: 'inconclusive' })];
    const results = await analyzeFailures(scored, mockProvider);
    expect(results).toHaveLength(1);
    expect(results[0].analysis).toBeDefined();
  });

  it('skips passing tests', async () => {
    const scored = [makeScoredResult({ testName: 'good test', verdict: 'passing' })];
    const results = await analyzeFailures(scored, mockProvider);
    expect(results).toHaveLength(1);
    expect(results[0].analysis).toBeUndefined();
  });

  it('handles provider errors gracefully', async () => {
    const errorProvider: LLMProvider = {
      name: 'error',
      async analyze() {
        throw new Error('API error');
      },
    };
    const scored = [makeScoredResult({ verdict: 'flaky' })];
    const results = await analyzeFailures(scored, errorProvider);
    expect(results).toHaveLength(1);
    expect(results[0].analysis?.rootCauseCategory).toBe('error');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/analyzer/
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the analyzer orchestrator**

Create `src/analyzer/index.ts`:

```typescript
import type { ScoredResult, Analysis } from '../types.js';
import type { LLMProvider } from './providers/types.js';

export type AnalyzedResult = ScoredResult & { analysis?: Analysis };

export async function analyzeFailures(
  scored: ScoredResult[],
  provider: LLMProvider
): Promise<AnalyzedResult[]> {
  const results: AnalyzedResult[] = [];

  for (const item of scored) {
    if (item.verdict === 'passing') {
      results.push({ ...item });
      continue;
    }

    try {
      const analysis = await provider.analyze({
        testName: item.testName,
        suite: item.suite,
        failureMessage: item.failureMessage ?? '',
        stackTrace: item.stackTrace ?? '',
      });
      results.push({ ...item, analysis });
    } catch (err) {
      results.push({
        ...item,
        analysis: {
          rootCauseCategory: 'error',
          explanation: `Analysis failed: ${err instanceof Error ? err.message : String(err)}`,
          suggestedFix: '',
          confidence: 'low',
        },
      });
    }
  }

  return results;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/analyzer/
```

Expected: All tests PASS.

- [ ] **Step 5: Add analyze command to CLI**

Update `src/cli.ts` — add the `analyze` command:

```typescript
import { analyzeFailures } from './analyzer/index.js';
import { createClaudeProvider } from './analyzer/providers/claude.js';

// ... inside the command switch ...

if (command === 'analyze') {
  const dir = args[0];
  if (!dir) {
    console.error('Usage: flaky-triager analyze <directory>');
    process.exit(1);
  }

  const summaries = parseJUnitXMLFiles(dir);
  const allResults = summaries.flatMap((s) => s.results);
  const scored = scoreTestResults(allResults);
  const provider = createClaudeProvider();
  const analyzed = await analyzeFailures(scored, provider);

  for (const r of analyzed) {
    if (r.verdict === 'passing') continue;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`${r.verdict.toUpperCase()} [${r.flakinessScore}] ${r.suite} > ${r.testName}`);
    if (r.analysis) {
      console.log(`Category: ${r.analysis.rootCauseCategory}`);
      console.log(`Explanation: ${r.analysis.explanation}`);
      console.log(`Suggested fix: ${r.analysis.suggestedFix}`);
      console.log(`Confidence: ${r.analysis.confidence}`);
    }
  }
}
```

- [ ] **Step 6: Test CLI with real LLM (requires ANTHROPIC_API_KEY)**

```bash
export ANTHROPIC_API_KEY=your-key-here
npx tsx src/cli.ts analyze tests/fixtures/
```

Expected: Prints analysis with root-cause categories and explanations for each failed test.

- [ ] **Step 7: Commit**

```bash
git add src/analyzer/ src/cli.ts tests/analyzer/
git commit -m "feat: add LLM analyzer with Claude provider and CLI command"
```

---

# Phase 6: Agent — GitHub Action (Loop A: Explain)

**Repo:** `flaky-triager`
**Goal:** Package the agent as a GitHub Action that posts PR comments with triage results.
**Time estimate:** One 2-3 hour sitting.

---

### Task 6.1: Reporter Module (TDD)

**Files:**
- Create: `src/reporter/index.ts`, `src/reporter/formats/markdown.ts`, `src/reporter/formats/cli.ts`, `src/reporter/formats/json.ts`
- Test: `tests/reporter/reporter.test.ts`

The reporter takes `AnalyzedResult[]` and formats them. The key output for Phase 6 is the **markdown format** used in PR comments.

- [ ] **Step 1: Write reporter tests** — test that markdown output includes verdict badges, explanations, and a summary table.
- [ ] **Step 2: Implement the markdown formatter** — renders each failed test as a collapsible `<details>` section with verdict, score, explanation, and suggested fix.
- [ ] **Step 3: Implement CLI and JSON formatters** — straightforward text and JSON serialization.
- [ ] **Step 4: Run tests, verify pass**
- [ ] **Step 5: Commit**

---

### Task 6.2: GitHub Action Definition

**Files:**
- Create: `action.yml`, `src/action.ts`

- [ ] **Step 1: Create `action.yml`** — defines inputs (`github-token`, `artifact-name`), outputs, and runs with `node20`.
- [ ] **Step 2: Create `src/action.ts`** — the Action entry point that:
  1. Uses `@actions/github` to get the workflow run context
  2. Downloads JUnit XML artifacts using GitHub API
  3. Runs the parse → score → analyze pipeline
  4. Posts a PR comment using `@actions/github` (creates or updates a comment with a marker)
- [ ] **Step 3: Bundle with esbuild** — single-file bundle for the Action.
- [ ] **Step 4: Test against demo repo** — add the Action to `flaky-demo-app`'s CI workflow, trigger a run, verify the PR comment appears.
- [ ] **Step 5: Commit**

---

### Task 6.3: Integration Test Against Demo Repo

- [ ] **Step 1: Add the flaky-triager Action to `flaky-demo-app/.github/workflows/ci.yml`** as a step after test execution.
- [ ] **Step 2: Open a PR on demo repo, trigger CI, verify the comment is posted** with correct flaky/inconclusive verdicts and explanations.
- [ ] **Step 3: Verify the comment correctly identifies** the cache timing test as flaky and the filter bug as inconclusive.

---

# Phase 7: Agent — Firestore History + Improved Scoring

**Repo:** `flaky-triager`
**Goal:** Persistent test history in Firestore. Enhanced scorer with cross-SHA pattern analysis.
**Time estimate:** One 2-3 hour sitting.

---

### Task 7.1: Firestore Client

**Files:**
- Create: `src/history/index.ts`, `src/history/firestore.ts`

- [ ] **Step 1: Install Firebase Admin SDK** — `npm install firebase-admin`
- [ ] **Step 2: Define history store interface** — `saveResults(sha, branch, results)` and `getHistory(testName, limit)`.
- [ ] **Step 3: Implement Firestore client** — stores documents in `test-runs/{sha}/results/{testName}` collection.
- [ ] **Step 4: Write tests with Firestore emulator** — use `@firebase/rules-unit-testing` or mock the client.
- [ ] **Step 5: Commit**

---

### Task 7.2: Enhanced Scorer

**Files:**
- Modify: `src/scorer/index.ts`
- Test: `tests/scorer/scorer.test.ts` (add history-based tests)

- [ ] **Step 1: Extend scorer to accept optional history** — `scoreTestResults(results, history?)`.
- [ ] **Step 2: Add cross-SHA failure pattern detection** — if a test has failed intermittently across multiple SHAs that don't touch its code, it's flaky.
- [ ] **Step 3: Add code-change correlation** — if a test started failing consistently after a SHA that modified relevant files, it's a real break.
- [ ] **Step 4: Update scoring** — `inconclusive` verdicts from Phase 4 can now be upgraded to `flaky` or `real_break` with history data.
- [ ] **Step 5: Write tests for new scoring logic**
- [ ] **Step 6: Add `history` CLI command** — `npx flaky-triager history <test-name>` shows run history.
- [ ] **Step 7: Commit**

---

# Phase 8: Agent — GitHub Action (Loop B: Quarantine)

**Repo:** `flaky-triager`
**Goal:** Agent recommends quarantine for flaky tests. Opens PRs to add/remove tests from `.flaky-quarantine.json`.
**Time estimate:** One 2-3 hour sitting.

---

### Task 8.1: Quarantine File Manager

**Files:**
- Create: `src/quarantine/index.ts`
- Test: `tests/quarantine/quarantine.test.ts`

- [ ] **Step 1: Write tests** — read/write `.flaky-quarantine.json`, add/remove entries, prevent duplicates.
- [ ] **Step 2: Implement quarantine manager** — CRUD operations on the quarantine file.
- [ ] **Step 3: Commit**

---

### Task 8.2: Quarantine PR Creator

**Files:**
- Create: `src/quarantine/prCreator.ts`

- [ ] **Step 1: Implement PR creation** — uses GitHub API to create a branch, commit the updated quarantine file, and open a PR.
- [ ] **Step 2: Implement un-quarantine detection** — when a quarantined test passes consistently for N runs (configurable, default 10), open a PR to remove it.
- [ ] **Step 3: Update the Action** to include quarantine recommendations in the PR comment with a "Quarantine this test" link.
- [ ] **Step 4: Test against demo repo**
- [ ] **Step 5: Commit**

---

### Task 8.3: CI Integration for Quarantine

**Files:**
- Create: helper script or Vitest plugin for reading `.flaky-quarantine.json`

- [ ] **Step 1: Create a test helper** that reads `.flaky-quarantine.json` and marks quarantined test failures as expected/non-blocking.
- [ ] **Step 2: Add to demo repo's CI** — demonstrate that quarantined test failures don't fail the build.
- [ ] **Step 3: Commit**

---

# Phase 9: Agent — Cloud Run Service

**Repo:** `flaky-triager`
**Goal:** Webhook-driven Cloud Run service for automatic triage without requiring a GitHub Action in each repo.
**Time estimate:** One 2-3 hour sitting.

---

### Task 9.1: Cloud Run HTTP Service

**Files:**
- Create: `src/service/index.ts`, `src/service/webhookHandler.ts`, `Dockerfile`

- [ ] **Step 1: Create Express HTTP service** — receives GitHub `workflow_run.completed` webhook events.
- [ ] **Step 2: Implement webhook handler** — validates webhook signature, downloads artifacts, runs triage pipeline, posts comment.
- [ ] **Step 3: Create Dockerfile** — multi-stage build for Cloud Run.
- [ ] **Step 4: Deploy to Cloud Run** — `gcloud run deploy`.
- [ ] **Step 5: Register as GitHub webhook** on the demo repo.
- [ ] **Step 6: Test end-to-end** — push to demo repo, verify Cloud Run receives webhook, runs triage, posts comment.
- [ ] **Step 7: Commit**

---

### Task 9.2: Autonomy Ladder Configuration

**Files:**
- Create: `src/service/config.ts`

- [ ] **Step 1: Add configuration** — auto-quarantine threshold (score > 90), auto-un-quarantine after N consecutive passes, notification preferences.
- [ ] **Step 2: Implement auto-quarantine** — for high-confidence flakes, skip human confirmation and open PR directly.
- [ ] **Step 3: Test against demo repo** — verify auto-quarantine triggers correctly and doesn't quarantine real breaks.
- [ ] **Step 4: Commit**

---

## Self-Review Notes

- **Spec coverage:** All 14 test scenarios covered (Tasks 2.1-2.14). All 9 phases mapped to tasks. Parser, scorer, analyzer, reporter, CLI, GitHub Action, Firestore, quarantine, Cloud Run all have tasks.
- **Phase 6-9 detail level:** Task structure and file paths are clear. Full code deferred because these phases depend on what Phases 1-5 actually produce. Each phase will be detailed when started.
- **Type consistency:** `TestResult`, `ScoredResult`, `Analysis`, `FailureContext`, `TriageReport` types defined in Task 3.2 and used consistently across parser (3.4), scorer (4.1), analyzer (5.3), and reporter (6.1).
- **No placeholders:** Phases 1-5 have complete code. Phases 6-9 have clear task descriptions with file paths — the "what" is unambiguous, the "how" is deferred by design.

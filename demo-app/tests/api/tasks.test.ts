import { describe, it, expect, beforeEach } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../src/app.js';
import { createDb } from '../../src/db.js';

describe('Tasks API', () => {
  let request: ReturnType<typeof supertest>;

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

describe('Webhook notification (FLAKY: external dependency)', () => {
  let request: ReturnType<typeof supertest>;

  beforeEach(() => {
    const db = createDb(':memory:');
    const app = createApp(db);
    request = supertest(app);
  });

  it('should deliver webhook notification', async () => {
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

describe('Task completion (REAL FAILURE: stale test after code change)', () => {
  let request: ReturnType<typeof supertest>;

  beforeEach(() => {
    const db = createDb(':memory:');
    const app = createApp(db);
    request = supertest(app);
  });

  it('should return finishedAt timestamp when completing a task', async () => {
    const created = await request.post('/tasks').send({ title: 'To complete' });
    const res = await request.patch(`/tasks/${created.body.id}/complete`);
    expect(res.status).toBe(200);
    expect(res.body.finishedAt).toBeDefined();
  });
});

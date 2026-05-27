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
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('done');
  });
});

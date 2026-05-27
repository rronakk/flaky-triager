import { describe, it, expect } from 'vitest';
import {
  formatTaskForDisplay,
  displayHistory,
  trackDisplay,
  getRecentDisplays,
} from '../../src/utils/formatting.js';
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

describe('display history (FLAKY: test-order dependency)', () => {
  it('should show recently displayed tasks', () => {
    const recent = getRecentDisplays(1);
    expect(recent).toContain('Task A');
  });

  it('tracks a displayed task', () => {
    trackDisplay(makeTask({ title: 'Task A' }));
    expect(displayHistory).toContain('Task A');
  });
});

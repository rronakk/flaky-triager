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

describe('isOverdue edge cases (FLAKY: time-sensitive)', () => {
  it('should detect a task that just became overdue', () => {
    const justNow = new Date().toISOString();
    const result = isOverdue(justNow, 5);
    expect(result).toBe(false);
  });
});

describe('getCompletionPercentage precision (FLAKY: floating-point)', () => {
  it('should return exactly 33.33 for 1 of 3 tasks done', () => {
    const result = getCompletionPercentage(1, 3);
    expect(result).toBe(33.33);
  });
});

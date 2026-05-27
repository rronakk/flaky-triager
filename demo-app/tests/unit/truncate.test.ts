import { describe, it, expect } from 'vitest';
import { truncateText } from '../../src/utils/truncate.js';

describe('truncateText (REAL FAILURE: dependency version break)', () => {
  it('should truncate at 30 characters by default', () => {
    const input = 'This is a fairly long task title that needs truncation';
    const result = truncateText(input);
    expect(result).toBe('This is a fairly long task tit...');
    expect(result.length).toBe(33);
  });
});

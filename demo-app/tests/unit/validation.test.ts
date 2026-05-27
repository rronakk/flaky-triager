import { describe, it, expect } from 'vitest';
import { faker } from '@faker-js/faker';
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

describe('validateCreateInput with generated data (FLAKY: randomness)', () => {
  it('should accept any reasonable task title', () => {
    const title = faker.lorem.sentence({ min: 3, max: 40 });
    const result = validateCreateInput({ title });
    expect(result.valid).toBe(true);
  });
});

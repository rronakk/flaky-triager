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

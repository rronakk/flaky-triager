import type { Task } from '../types.js';

export function formatTaskForDisplay(task: Task): string {
  const checkbox = task.status === 'done' ? '[x]' : '[ ]';
  const desc = task.description ? ` — ${task.description}` : '';
  return `${checkbox} ${task.title}${desc}`;
}

export const displayHistory: string[] = [];

export function trackDisplay(task: Task): void {
  displayHistory.push(task.title);
}

export function getRecentDisplays(count: number): string[] {
  return displayHistory.slice(-count);
}

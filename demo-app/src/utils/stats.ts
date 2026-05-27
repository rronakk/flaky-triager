export function getCompletionPercentage(done: number, total: number): number {
  if (total === 0) return 0;
  return (done / total) * 100;
}

export function isOverdue(createdAt: string, dueInMs: number): boolean {
  const created = new Date(createdAt).getTime();
  return Date.now() > created + dueInMs;
}

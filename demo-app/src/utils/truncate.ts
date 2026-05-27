const DEFAULT_LENGTH = 20;

export function truncateText(text: string, length: number = DEFAULT_LENGTH): string {
  if (text.length <= length) return text;
  return text.slice(0, length) + '...';
}

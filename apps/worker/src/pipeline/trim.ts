// Sentence endings in English and Arabic (؟ is the Arabic question mark, ۔ the Arabic full stop).
const SENTENCE_END = /[.!?؟۔\n]/g;

/**
 * Enforces the persona's reply length limit on the server. Cuts at the last sentence end that keeps at least
 * half of the allowed length; otherwise at the last space; otherwise hard. The result is never longer than `max`.
 */
export function trimToLength(text: string, max: number): string {
  const clean = text.trim();
  if (clean.length <= max) return clean;
  const window = clean.slice(0, max);
  let lastEnd = -1;
  for (const match of window.matchAll(SENTENCE_END)) lastEnd = match.index;
  if (lastEnd >= Math.floor(max / 2)) return window.slice(0, lastEnd + 1).trim();
  const lastSpace = window.lastIndexOf(' ');
  return (lastSpace > 0 ? window.slice(0, lastSpace) : window).trim();
}

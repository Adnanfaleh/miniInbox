// Shared by the persona API (validation) and the worker (working-hours check).
export const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

/**
 * Parses the persona's working days, e.g. `MON-FRI`, `SUN-THU`, `MON,WED,FRI` or `SAT-SUN,WED`.
 * Ranges may wrap around the week. Returns null when the format is not understood.
 */
export function parseWorkingDays(spec: string): Set<number> | null {
  const days = new Set<number>();
  for (const part of spec.toUpperCase().split(',').map((p) => p.trim()).filter(Boolean)) {
    const [from, to] = part.split('-').map((d) => DAYS.indexOf(d.trim() as (typeof DAYS)[number]));
    if (from === undefined || from < 0) return null;
    if (to === undefined) {
      days.add(from);
      continue;
    }
    if (to < 0) return null;
    for (let d = from; ; d = (d + 1) % 7) {
      days.add(d);
      if (d === to) break;
    }
  }
  return days.size > 0 ? days : null;
}


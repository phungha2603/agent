/** Returns the next upcoming timestamp (ms) matching one of the "HH:MM" times, today or tomorrow. */
export function nextDailyTimestamp(times: string[], from: Date = new Date()): number {
  if (times.length === 0) return from.getTime();
  const candidates = times.map((t) => {
    const [h, m] = t.split(":").map(Number);
    const d = new Date(from);
    d.setHours(h, m, 0, 0);
    if (d.getTime() <= from.getTime()) d.setDate(d.getDate() + 1);
    return d.getTime();
  });
  return Math.min(...candidates);
}

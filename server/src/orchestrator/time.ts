interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(date: Date, timezone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  // Intl can report midnight as "24" in the two-digit hour-cycle it defaults to.
  const hour = parts.hour === "24" ? 0 : Number(parts.hour);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Converts a wall-clock date/time as seen in `timezone` to the UTC instant
 * (ms) it corresponds to, using the standard "format a guess, measure the
 * offset, correct the guess" trick — avoids pulling in a date/timezone
 * library for the one thing this project needs it for. */
function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timezone: string): number {
  const guessUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  const seenInZone = zonedParts(new Date(guessUtcMs), timezone);
  const seenAsUtcMs = Date.UTC(seenInZone.year, seenInZone.month - 1, seenInZone.day, seenInZone.hour, seenInZone.minute, seenInZone.second);
  const offset = seenAsUtcMs - guessUtcMs;
  return guessUtcMs - offset;
}

/** Returns the next upcoming timestamp (ms) matching one of the "HH:MM" times,
 * today or tomorrow. Without `timezone`, times are read in the server
 * process's own local time (its prior behavior); with it, they're read as
 * wall-clock times in that IANA zone regardless of where the server runs. */
export function nextDailyTimestamp(times: string[], from: Date = new Date(), timezone?: string): number {
  if (times.length === 0) return from.getTime();

  if (!timezone) {
    const candidates = times.map((t) => {
      const [h, m] = t.split(":").map(Number);
      const d = new Date(from);
      d.setHours(h, m, 0, 0);
      if (d.getTime() <= from.getTime()) d.setDate(d.getDate() + 1);
      return d.getTime();
    });
    return Math.min(...candidates);
  }

  const today = zonedParts(from, timezone);
  const tomorrow = zonedParts(new Date(from.getTime() + 24 * 60 * 60 * 1000), timezone);
  const candidates = times.map((t) => {
    const [h, m] = t.split(":").map(Number);
    const todayMs = zonedTimeToUtc(today.year, today.month, today.day, h, m, timezone);
    if (todayMs > from.getTime()) return todayMs;
    return zonedTimeToUtc(tomorrow.year, tomorrow.month, tomorrow.day, h, m, timezone);
  });
  return Math.min(...candidates);
}

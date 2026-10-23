/** Patricia's time zone. Every wall-clock time the app reads or writes is in it. */
export const SANTIAGO = "America/Santiago";

/** A wall-clock reading in Santiago. `month` is 1-12; `weekday` is 0 (Sunday) to 6 (Saturday). */
export type SantiagoParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
};

/** A wall-clock time to resolve; omitted time fields are 0. */
export type SantiagoWall = {
  year: number;
  month: number;
  day: number;
  hour?: number;
  minute?: number;
  second?: number;
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: SANTIAGO,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

/** What a wall clock in Santiago shows at `instant`. */
export function santiagoParts(instant: Date): SantiagoParts {
  const values: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  const year = values.year!;
  const month = values.month!;
  const day = values.day!;
  return {
    year,
    month,
    day,
    hour: values.hour!,
    minute: values.minute!,
    second: values.second!,
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

/** The Santiago calendar day of `instant`, as `YYYY-MM-DD`. */
export function santiagoDate(instant: Date): string {
  const { year, month, day } = santiagoParts(instant);
  return `${String(year).padStart(4, "0")}-${pad(month)}-${pad(day)}`;
}

/**
 * The instant a Santiago wall clock shows `wall`. A time skipped when DST
 * starts resolves forward by the gap (00:30 becomes 01:30 -03); a time that
 * happens twice when DST ends resolves to the earlier instant. Offsets come
 * from Intl, never from hardcoded rule dates.
 */
export function fromSantiago(wall: SantiagoWall): Date {
  const { year, month, day, hour = 0, minute = 0, second = 0 } = wall;
  const wallMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(wallMs);
  if (
    !Number.isInteger(year) ||
    !Number.isFinite(wallMs) ||
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute ||
    check.getUTCSeconds() !== second
  ) {
    throw new RangeError(`invalid Santiago wall time: ${JSON.stringify(wall)}`);
  }

  // Santiago changes offset at most once within a day either side, so the
  // offsets a day before and after cover every candidate.
  const before = offsetAt(wallMs - DAY_MS);
  const after = offsetAt(wallMs + DAY_MS);
  const matches = [...new Set([before, after])]
    .map((offset) => wallMs - offset)
    .filter((ms) => wallOf(ms) === wallMs)
    .sort((a, b) => a - b);
  if (matches.length > 0) return new Date(matches[0]!);
  // The wall time falls in the DST gap: reading it with the offset in force
  // before the jump lands the gap's length later on the clock.
  return new Date(wallMs - before);
}

const WALL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Parses `YYYY-MM-DDTHH:mm[:ss]` as Santiago wall time. Offsets, `Z` and malformed text throw `RangeError`. */
export function parseSantiago(text: string): Date {
  const match = WALL_PATTERN.exec(text);
  if (!match) throw new RangeError(`not a Santiago wall time: ${text}`);
  const [, year, month, day, hour, minute, second] = match;
  return fromSantiago({
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: second === undefined ? 0 : Number(second),
  });
}

/** The wall clock at `ms`, read as if it were UTC, in milliseconds (whole seconds). */
function wallOf(ms: number): number {
  const p = santiagoParts(new Date(ms));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/** Santiago's offset from UTC at `ms`, in milliseconds (negative: behind UTC). */
function offsetAt(ms: number): number {
  const whole = Math.floor(ms / 1000) * 1000;
  return wallOf(whole) - whole;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

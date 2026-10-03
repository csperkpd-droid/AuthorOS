/**
 * Calendar dates ("YYYY-MM-DD") in the author's time zone. Date-only columns
 * are stored as UTC midnight; these helpers convert without drifting a day.
 * Client-safe.
 */

export type DateString = string;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateString(value: string): value is DateString {
  if (!DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  // Rejects dates that roll over, such as 30 February.
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The calendar date at `at` in `timeZone`. */
export function localDate(timeZone: string, at: Date = new Date()): DateString {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** A date-only value for the database (UTC midnight). */
export function toDbDate(date: DateString): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/** A date-only database value back to "YYYY-MM-DD". */
export function fromDbDate(value: Date): DateString {
  return value.toISOString().slice(0, 10);
}

export function addDays(date: DateString, days: number): DateString {
  const d = toDbDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromDbDate(d);
}

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: DateString, to: DateString): number {
  return Math.round((toDbDate(to).getTime() - toDbDate(from).getTime()) / 86_400_000);
}

/** Monday-first weeks: the first day shown in a month grid. */
export function startOfMonthGrid(month: string): DateString {
  const first = toDbDate(`${month}-01`);
  const weekday = (first.getUTCDay() + 6) % 7; // Monday = 0
  return addDays(`${month}-01`, -weekday);
}

/** "2026-10" for a date. */
export function monthOf(date: DateString): string {
  return date.slice(0, 7);
}

export function addMonths(month: string, months: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return d.toISOString().slice(0, 7);
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

type DayFormat = {
  weekday?: "long" | "short";
  day?: "numeric";
  month?: "long" | "short";
  year?: "numeric";
};

/**
 * "Friday 9 October" style labels. Built by hand rather than with Intl, so
 * server and browser render exactly the same text (their ICU data differs).
 * Pass `undefined` for a part to leave it out.
 */
export function formatDay(
  date: DateString,
  options: Partial<Record<keyof DayFormat, string | undefined>> = {},
): string {
  const o: DayFormat = { weekday: "long", day: "numeric", month: "long", ...options } as DayFormat;
  const d = toDbDate(date);
  const cut = (name: string, style?: string) => (style === "short" ? name.slice(0, 3) : name);
  return [
    o.weekday && cut(WEEKDAYS[d.getUTCDay()], o.weekday),
    o.day && String(d.getUTCDate()),
    o.month && cut(MONTHS[d.getUTCMonth()], o.month),
    o.year && String(d.getUTCFullYear()),
  ]
    .filter(Boolean)
    .join(" ");
}

import type { Summary } from './queue';

/**
 * Records from before today, by the calendar day on the wall — not by 24 hours
 * elapsed. "Delete yesterday's" is what a staff member means, and it is the
 * rule they can check against a clock without doing arithmetic.
 *
 * `now` is a parameter so the boundary is testable without waiting for midnight.
 */
export function fromBeforeToday(records: Summary[], now: Date = new Date()): Summary[] {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  return records.filter((record) => new Date(record.submitted_at) < midnight);
}

/**
 * The calendar day on the wall clock, as a value that changes at midnight and
 * nowhere else. What the end-of-day prompt is answered for: a front desk that
 * leaves the window open all week still gets asked each morning.
 */
export function dayKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
}

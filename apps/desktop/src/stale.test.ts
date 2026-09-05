import { describe, expect, it } from 'vitest';

import type { Summary } from './queue';
import { dayKey, fromBeforeToday } from './stale';

const NOW = new Date('2026-08-13T09:00:00');

function at(submitted_at: string): Summary {
  return { id: 'a3f9', name: 'Jane Doe', submitted_at, entered_at: null };
}

describe('what counts as yesterday', () => {
  it('takes anything before local midnight, however recent', () => {
    // Ten hours old, and still yesterday's — which is the point of using the
    // calendar day rather than a rolling 24 hours.
    const late = at(new Date('2026-08-12T23:00:00').toISOString());
    expect(fromBeforeToday([late], NOW)).toEqual([late]);
  });

  it('leaves today alone, including the minute after midnight', () => {
    const early = at(new Date('2026-08-13T00:30:00').toISOString());
    expect(fromBeforeToday([early], NOW)).toEqual([]);
  });

  it('keeps them in the order it was given', () => {
    const older = at(new Date('2026-08-11T10:00:00').toISOString());
    const newer = at(new Date('2026-08-12T10:00:00').toISOString());
    const today = at(new Date('2026-08-13T08:00:00').toISOString());

    expect(fromBeforeToday([newer, today, older], NOW)).toEqual([newer, older]);
  });
});

describe('the day the prompt is answered for', () => {
  it('is the same value all day', () => {
    expect(dayKey(new Date('2026-08-13T00:00:00'))).toBe(dayKey(new Date('2026-08-13T23:59:59')));
  });

  it('changes at midnight, which is what brings the prompt back', () => {
    expect(dayKey(new Date('2026-08-14T00:00:00'))).not.toBe(dayKey(NOW));
  });
});

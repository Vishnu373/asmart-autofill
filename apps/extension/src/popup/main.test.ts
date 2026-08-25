import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FillResult } from '../content/fill';
import type { Waiting } from '../shared/types';

type Outcome = FillResult | 'unconfigured' | 'failed' | null;

const tabs = {
  query: vi.fn(async () => [{ id: 7 }]),
  sendMessage: vi.fn(async (): Promise<Outcome> => filled(['first_name'])),
};

function filled(names: FillResult['filled'] = [], rest: Partial<FillResult> = {}): FillResult {
  return { filled: names, missing: [], occupied: [], ...rest };
}

const NEWER: Waiting = { id: 'b', name: 'Priya Raman', submitted_at: '2026-08-20T18:41:00Z' };
const OLDER: Waiting = { id: 'a', name: 'John Smith', submitted_at: '2026-08-20T18:12:00Z' };

/** The application on 8787 serving a waiting list, or nothing answering at all. */
function serving(waiting: Waiting[] | null) {
  return vi.fn(async (url: string) => {
    const { port, pathname } = new URL(url);
    if (waiting === null || Number(port) !== 8787) {
      throw new TypeError('Failed to fetch');
    }
    const body = pathname === '/api/health' ? { ok: true } : waiting;
    return { ok: true, json: async () => body };
  });
}

function open() {
  document.body.innerHTML = '<div id="root"></div>';
  vi.resetModules();
  return import('./main');
}

function shown(selector: string) {
  return Array.from(document.querySelectorAll(selector), (node) => node.textContent);
}

beforeEach(() => {
  vi.stubGlobal('chrome', { tabs });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('the waiting list', () => {
  it('lists everyone waiting, newest first', async () => {
    vi.stubGlobal('fetch', serving([NEWER, OLDER]));

    await open();

    await vi.waitFor(() => expect(shown('.name')).toEqual(['Priya Raman', 'John Smith']));
  });

  it('shows a local time, not the raw stamp', async () => {
    vi.stubGlobal('fetch', serving([NEWER]));

    await open();

    await vi.waitFor(() => expect(document.querySelector('.time')).not.toBeNull());
    const time = document.querySelector('.time') as HTMLTimeElement;
    expect(time.dateTime).toBe(NEWER.submitted_at);
    expect(time.textContent).not.toContain('T');
    expect(time.textContent).toMatch(/\d/);
  });

  it('says so when nobody is waiting', async () => {
    vi.stubGlobal('fetch', serving([]));

    await open();

    await vi.waitFor(() => expect(shown('.empty p')).toEqual(['No one is waiting.']));
    expect(document.querySelectorAll('.patient')).toHaveLength(0);
  });

  it('points at the application when nothing answers', async () => {
    vi.stubGlobal('fetch', serving(null));

    await open();

    await vi.waitFor(() =>
      expect(shown('.down p')).toEqual([
        'The front desk application is not running.',
        'Start it on this computer, then open this again.',
      ]),
    );
  });
});

describe('picking a patient', () => {
  it('hands that patient id to the active tab', async () => {
    vi.stubGlobal('fetch', serving([NEWER, OLDER]));

    await open();
    await vi.waitFor(() => expect(document.querySelectorAll('.patient')).toHaveLength(2));
    document.querySelectorAll<HTMLButtonElement>('.patient')[1].click();

    await vi.waitFor(() =>
      expect(tabs.sendMessage).toHaveBeenCalledWith(7, { kind: 'fill', id: 'a' }),
    );
    expect(tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
  });

  /** A double click would meet the values the first pick wrote, and be refused as occupied. */
  it('will not send a second time once boxes were filled', async () => {
    vi.stubGlobal('fetch', serving([NEWER]));

    await open();
    await vi.waitFor(() => expect(document.querySelectorAll('.patient')).toHaveLength(1));
    const row = document.querySelector('.patient') as HTMLButtonElement;
    row.click();

    await vi.waitFor(() => expect(document.querySelector('.note')).not.toBeNull());
    row.click();

    expect(row.disabled).toBe(true);
    expect(tabs.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('lets staff pick again when nothing was filled', async () => {
    vi.stubGlobal('fetch', serving([NEWER]));
    tabs.sendMessage.mockResolvedValueOnce(filled([], { occupied: ['last_name'] }));

    await open();
    await vi.waitFor(() => expect(document.querySelectorAll('.patient')).toHaveLength(1));
    const row = document.querySelector('.patient') as HTMLButtonElement;
    row.click();

    await vi.waitFor(() => expect(document.querySelector('.note')).not.toBeNull());
    expect(row.disabled).toBe(false);
  });

  it('asks for the record to be open when the tab does not take it', async () => {
    vi.stubGlobal('fetch', serving([NEWER]));
    tabs.sendMessage.mockRejectedValueOnce(new Error('no receiving end'));

    await open();
    await vi.waitFor(() => expect(document.querySelectorAll('.patient')).toHaveLength(1));
    document.querySelector<HTMLButtonElement>('.patient')?.click();

    await vi.waitFor(() =>
      expect(document.querySelector('.note.problem')?.textContent).toBe(
        "Open the patient's record in OSCAR first, then pick them again.",
      ),
    );
  });
});

describe('what the fill did', () => {
  async function pickOne(result: Outcome) {
    vi.stubGlobal('fetch', serving([NEWER]));
    tabs.sendMessage.mockResolvedValueOnce(result);

    await open();
    await vi.waitFor(() => expect(document.querySelectorAll('.patient')).toHaveLength(1));
    document.querySelector<HTMLButtonElement>('.patient')?.click();

    await vi.waitFor(() => expect(document.querySelector('.note')).not.toBeNull());
    return document.querySelector('.note') as HTMLElement;
  }

  it('confirms a clean fill', async () => {
    const note = await pickOne(filled(['first_name', 'last_name']));

    expect(note.className).toContain('done');
    expect(note.textContent).toBe('2 boxes filled. Check them, then save in OSCAR.');
  });

  it('names the boxes it could not find rather than failing quietly', async () => {
    const note = await pickOne(filled(['first_name'], { missing: ['city', 'postal_code'] }));

    expect(note.className).toContain('problem');
    expect(note.textContent).toBe(
      '1 box filled. Could not find City, Postal code on this page — enter by hand.',
    );
  });

  it('explains a refusal by naming the box that was already taken', async () => {
    const note = await pickOne(filled([], { occupied: ['last_name'] }));

    expect(note.className).toContain('problem');
    expect(note.textContent).toContain('Last name already had something in it');
  });

  it('says so when the patient is gone', async () => {
    const note = await pickOne(null);

    expect(note.className).toContain('problem');
    expect(note.textContent).toBe('That patient is no longer waiting, or the application stopped.');
  });

  /** A missing field list is a broken install, and staff must not read it as a lost patient. */
  it('names the missing field list rather than blaming the patient', async () => {
    const note = await pickOne('unconfigured');

    expect(note.className).toContain('problem');
    expect(note.textContent).toBe(
      'Nothing was filled — this computer has no OSCAR field list. Enter this patient by hand, and tell whoever set the application up.',
    );
  });

  it('owns up when the extension itself failed', async () => {
    const note = await pickOne('failed');

    expect(note.className).toContain('problem');
    expect(note.textContent).toBe(
      'The extension ran into a problem. Check this page, and enter this patient by hand.',
    );
  });

  /** A field list that matched nothing is not a success, whatever the count says. */
  it('does not call an empty fill done', async () => {
    const note = await pickOne(filled([]));

    expect(note.className).toContain('problem');
    expect(note.textContent).toContain('none of the OSCAR boxes are set up on this computer');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const action = {
  setBadgeText: vi.fn(),
  setBadgeBackgroundColor: vi.fn(),
  setTitle: vi.fn(),
};

/** An application answering on one port, and nothing on any other. */
function serving(port: number | null, waiting: number = 0) {
  return vi.fn(async (url: string) => {
    const { port: asked, pathname } = new URL(url);
    if (port === null || Number(asked) !== port) {
      throw new TypeError('Failed to fetch');
    }
    const body =
      pathname === '/api/health'
        ? { ok: true }
        : Array.from({ length: waiting }, (_, index) => ({
            id: String(index),
            name: 'Patient',
            submitted_at: '2026-08-20T14:12:04Z',
          }));
    return { ok: true, json: async () => body };
  });
}

/** An application that is up and answers health, but refuses this extension. */
function refusing(port: number) {
  return vi.fn(async (url: string) => {
    const { port: asked, pathname } = new URL(url);
    if (Number(asked) !== port) {
      throw new TypeError('Failed to fetch');
    }
    return pathname === '/api/health'
      ? { ok: true, json: async () => ({ ok: true }) }
      : { ok: false, status: 403, json: async () => ({}) };
  });
}

function load() {
  vi.resetModules();
  return import('./poll');
}

function ports(fetched: ReturnType<typeof serving>) {
  return fetched.mock.calls.map(([url]) => Number(new URL(url).port));
}

function text() {
  return action.setBadgeText.mock.lastCall?.[0].text;
}

beforeEach(() => {
  vi.stubGlobal('chrome', { action });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('port discovery', () => {
  it('finds the application on the preferred port', async () => {
    const fetched = serving(8787, 2);
    vi.stubGlobal('fetch', fetched);

    const { poll } = await load();
    await poll();

    expect(ports(fetched)).toEqual([8787, 8787]);
    expect(text()).toBe('2');
  });

  it('walks the fallback range', async () => {
    const fetched = serving(8790, 3);
    vi.stubGlobal('fetch', fetched);

    const { poll } = await load();
    await poll();

    expect(ports(fetched)).toEqual([8787, 8788, 8789, 8790, 8790]);
    expect(text()).toBe('3');
  });

  it('remembers what answered', async () => {
    const fetched = serving(8790, 1);
    vi.stubGlobal('fetch', fetched);

    const { poll } = await load();
    await poll();
    fetched.mockClear();
    await poll();

    expect(ports(fetched)).toEqual([8790]);
  });

  it('gives up after the whole range refuses', async () => {
    const fetched = serving(null);
    vi.stubGlobal('fetch', fetched);

    const { poll } = await load();
    await poll();

    expect(ports(fetched)).toHaveLength(10);
  });

  it('discovers again after the application moves', async () => {
    const fetched = serving(8787, 1);
    vi.stubGlobal('fetch', fetched);

    const { poll } = await load();
    await poll();

    const moved = serving(8788, 4);
    vi.stubGlobal('fetch', moved);
    await poll();
    await poll();

    expect(text()).toBe('4');
  });
});

describe('the badge', () => {
  it('shows the waiting count', async () => {
    vi.stubGlobal('fetch', serving(8787, 5));

    const { poll } = await load();
    await poll();

    expect(text()).toBe('5');
    expect(action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({ color: '#1a7f37' });
    expect(action.setTitle).toHaveBeenLastCalledWith({ title: '5 patients waiting' });
  });

  it('clears when nobody is waiting', async () => {
    vi.stubGlobal('fetch', serving(8787, 0));

    const { poll } = await load();
    await poll();

    expect(text()).toBe('');
    expect(action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({ color: '#1a7f37' });
  });

  it('marks the application as not running', async () => {
    vi.stubGlobal('fetch', serving(null));

    const { poll } = await load();
    await poll();

    expect(text()).toBe('!');
    expect(action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({ color: '#b3261e' });
    expect(action.setTitle).toHaveBeenLastCalledWith({
      title: 'The front desk application is not running',
    });
  });

  it('does not call a refusal a stopped application', async () => {
    vi.stubGlobal('fetch', refusing(8787));

    const { poll } = await load();
    await poll();

    expect(text()).toBe('!');
    expect(action.setTitle).toHaveBeenLastCalledWith({
      title: 'The front desk application is running but will not accept this extension',
    });
  });

  it('goes to not running when the application stops answering', async () => {
    vi.stubGlobal('fetch', serving(8787, 2));

    const { poll } = await load();
    await poll();
    expect(text()).toBe('2');

    vi.stubGlobal('fetch', serving(null));
    await poll();

    expect(text()).toBe('!');
  });
});

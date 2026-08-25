import { afterEach, describe, expect, it, vi } from 'vitest';

const MAPPING = { emr: 'oscar', version: 1, fields: {}, save_button: '#save' };

/** The application on 8787. `mappingStatus` is what `GET /api/mapping` answers. */
function serving(mappingStatus: number = 200) {
  return vi.fn(async (url: string) => {
    const { port, pathname } = new URL(url);
    if (Number(port) !== 8787) {
      throw new TypeError('Failed to fetch');
    }
    if (pathname === '/api/health') {
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    if (pathname === '/api/mapping') {
      return { ok: mappingStatus === 200, status: mappingStatus, json: async () => MAPPING };
    }
    return { ok: true, status: 200, json: async () => [] };
  });
}

function load() {
  vi.resetModules();
  return import('./api');
}

function paths(fetched: ReturnType<typeof serving>) {
  return fetched.mock.calls.map(([url]) => new URL(url).pathname);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('the mapping', () => {
  it('comes back as the file on disk', async () => {
    vi.stubGlobal('fetch', serving());

    const { mapping } = await load();

    expect(await mapping()).toEqual(MAPPING);
  });

  it('is unconfigured when the application has none to give', async () => {
    vi.stubGlobal('fetch', serving(500));

    const { mapping } = await load();

    expect(await mapping()).toBe('unconfigured');
  });
});

describe('the remembered port', () => {
  it('survives an answer the application could not give', async () => {
    const fetched = serving(500);
    vi.stubGlobal('fetch', fetched);

    const { mapping } = await load();
    await mapping();
    fetched.mockClear();
    await mapping();

    // A second discovery would have gone back through /api/health.
    expect(paths(fetched)).toEqual(['/api/mapping']);
  });

  it('is dropped when nothing answers, so the next call looks again', async () => {
    vi.stubGlobal('fetch', serving());

    const { pending } = await load();
    await pending();

    const gone = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', gone);
    expect(await pending()).toBeNull();

    const back = serving();
    vi.stubGlobal('fetch', back);
    await pending();

    expect(paths(back)).toEqual(['/api/health', '/api/pending']);
  });
});

describe('marking a patient filled', () => {
  /** The page is already saved and the content script is going away: nobody else can retry. */
  function answering(fail: number) {
    let posts = 0;
    return vi.fn(async (url: string) => {
      const { pathname } = new URL(url);
      if (pathname === '/api/health') {
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      posts += 1;
      if (posts <= fail) {
        throw new TypeError('Failed to fetch');
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });
  }

  it('tries once more when nothing answered', async () => {
    const fetched = answering(1);
    vi.stubGlobal('fetch', fetched);

    const { markFilled } = await load();

    expect(await markFilled('a3f9')).toBe('done');
    expect(paths(fetched).filter((path) => path.endsWith('/filled'))).toHaveLength(2);
  });

  it('leaves it alone once the application has answered', async () => {
    const fetched = vi.fn(async (url: string) => {
      const { pathname } = new URL(url);
      return pathname === '/api/health'
        ? { ok: true, status: 200, json: async () => ({ ok: true }) }
        : { ok: false, status: 404, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetched);

    const { markFilled } = await load();

    expect(await markFilled('a3f9')).toBe('gone');
    expect(paths(fetched).filter((path) => path.endsWith('/filled'))).toHaveLength(1);
  });
});

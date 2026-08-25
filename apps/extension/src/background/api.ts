import type { Submission } from '@asmart/shared';

import type { Mapping, Waiting } from '../shared/types';

/** The range `server.rs` binds in, in the order it tries. */
const PORTS = Array.from({ length: 10 }, (_, offset) => 8787 + offset);

/** The port that last answered. Null until discovery, and again after a call fails. */
let port: number | null = null;

/**
 * Null means nothing on this machine answered — the application is not running.
 * A status code is an answer, so only a dead connection forgets the port; a
 * refusal or a fault would otherwise send every later call back through all ten.
 */
async function send(path: string, init?: RequestInit): Promise<Response | null> {
  port ??= await discover();
  if (port === null) {
    return null;
  }

  try {
    return await fetch(`http://127.0.0.1:${port}${path}`, init);
  } catch {
    port = null;
    return null;
  }
}

async function get<T>(path: string): Promise<T | null> {
  const response = await send(path);
  return response === null ? null : body<T>(response);
}

async function body<T>(response: Response): Promise<T | null> {
  if (!response.ok) {
    return null;
  }
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/**
 * `refused` is a live application that would not answer this extension — the
 * origin guard in `extension.rs`. Telling staff to restart something that is
 * already running would send them looking in the wrong place entirely.
 */
export async function pending(): Promise<Waiting[] | 'refused' | null> {
  const response = await send('/api/pending');
  if (response === null) {
    return null;
  }
  return response.ok ? body<Waiting[]>(response) : 'refused';
}

export function details(id: string): Promise<Submission | null> {
  return get<Submission>(`/api/pending/${id}`);
}

/**
 * `unconfigured` is the `500` the application answers when no `mapping.json`
 * loaded beside it. That is a broken install, not a patient who has gone — it
 * has to reach staff as its own message rather than as "the application stopped".
 */
export async function mapping(): Promise<Mapping | 'unconfigured' | null> {
  const response = await send('/api/mapping');
  if (response === null) {
    return null;
  }
  return response.status === 500 ? 'unconfigured' : body<Mapping>(response);
}

/**
 * `done` when we marked it, `gone` for the 404/409 the backend answers when it
 * expired or someone already entered it, null when nothing answered at all.
 */
export async function markFilled(id: string): Promise<'done' | 'gone' | null> {
  // The one call with nobody left to retry it: the page is already saved, and
  // the content script is on its way out. A failure clears the cached port, so
  // the second attempt rediscovers an application that moved or restarted.
  const first = await tell(id);
  return first === null ? tell(id) : first;
}

async function tell(id: string): Promise<'done' | 'gone' | null> {
  const response = await send(`/api/pending/${id}/filled`, { method: 'POST' });
  if (response === null) {
    return null;
  }
  if (response.status === 404 || response.status === 409) {
    return 'gone';
  }
  return response.ok ? 'done' : null;
}

async function discover(): Promise<number | null> {
  for (const candidate of PORTS) {
    if (await ours(candidate)) {
      return candidate;
    }
  }
  return null;
}

/** Health is unguarded and names the application, so a stranger on the port is not mistaken for it. */
async function ours(candidate: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${candidate}/api/health`);
    return response.ok && ((await response.json()) as { ok?: boolean }).ok === true;
  } catch {
    return false;
  }
}

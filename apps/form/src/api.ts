import { FIELDS, type Submission } from '@asmart/shared';

const TOKEN_KEY = 'asmart-token';

export type Outcome =
  | { kind: 'saved' }
  | { kind: 'invalid'; field: keyof Submission; reason: string }
  | { kind: 'unauthorized' }
  | { kind: 'busy' }
  | { kind: 'unreachable' }
  | { kind: 'broken' };

/** The QR puts the token on the URL; keeping it lets a plain reload still work. */
export function token(): string | null {
  const fromUrl = new URLSearchParams(location.search).get('t');
  if (fromUrl) {
    localStorage.setItem(TOKEN_KEY, fromUrl);
    return fromUrl;
  }
  return localStorage.getItem(TOKEN_KEY);
}

export async function send(submission: Submission, key: string): Promise<Outcome> {
  let response: Response;
  try {
    response = await fetch('/api/submissions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token() ?? ''}`,
        'idempotency-key': key,
      },
      body: JSON.stringify(submission),
    });
  } catch {
    // The request never landed. Health says whether that is the front desk
    // being away or this one route failing.
    return (await healthy()) ? { kind: 'broken' } : { kind: 'unreachable' };
  }

  switch (response.status) {
    case 201:
      return { kind: 'saved' };
    case 400:
      return await invalid(response);
    case 401:
      return { kind: 'unauthorized' };
    case 429:
      return { kind: 'busy' };
    default:
      return { kind: 'broken' };
  }
}

/** A 400 naming something other than a field means the two rule sets disagree. */
async function invalid(response: Response): Promise<Outcome> {
  const body = (await response.json().catch(() => null)) as { field?: string; reason?: string };
  const field = FIELDS.find((f) => f.name === body?.field);
  return field
    ? { kind: 'invalid', field: field.name, reason: body.reason ?? '' }
    : { kind: 'broken' };
}

async function healthy(): Promise<boolean> {
  try {
    return (await fetch('/api/health')).ok;
  } catch {
    return false;
  }
}

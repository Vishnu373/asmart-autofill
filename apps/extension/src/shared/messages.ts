import type { Submission } from '@asmart/shared';

import type { Mapping } from './types';

/**
 * A content script's own fetch carries the page's origin, which CORS and the
 * backend's origin guard both refuse. Everything it needs comes through the
 * service worker instead.
 */
export type Ask =
  { kind: 'details'; id: string } | { kind: 'mapping' } | { kind: 'filled'; id: string };

/** The popup telling the content script which patient staff picked. */
export interface Fill {
  kind: 'fill';
  id: string;
}

export function askDetails(id: string): Promise<Submission | null> {
  return chrome.runtime.sendMessage<Ask, Submission | null>({ kind: 'details', id });
}

export function askMapping(): Promise<Mapping | 'unconfigured' | null> {
  return chrome.runtime.sendMessage<Ask, Mapping | 'unconfigured' | null>({ kind: 'mapping' });
}

export function askFilled(id: string): Promise<'done' | 'gone' | null> {
  return chrome.runtime.sendMessage<Ask, 'done' | 'gone' | null>({ kind: 'filled', id });
}

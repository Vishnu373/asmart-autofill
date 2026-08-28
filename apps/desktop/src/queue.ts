import type { Submission } from '@asmart/shared';
import { invoke } from '@tauri-apps/api/core';

/** What the waiting list shows: names and times only. */
export interface Summary {
  id: string;
  name: string;
  /** RFC 3339, UTC. */
  submitted_at: string;
}

export async function listWaiting(): Promise<Summary[]> {
  return invoke<Summary[]>('list_waiting');
}

export async function getSubmission(id: string): Promise<Submission | null> {
  return invoke<Submission | null>('get_submission', { id });
}

/** False when the entry had already gone — swept, or entered on a second look. */
export async function markEntered(id: string): Promise<boolean> {
  return invoke<boolean>('mark_entered', { id });
}

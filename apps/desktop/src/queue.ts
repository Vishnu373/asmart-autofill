import type { Submission } from '@asmart/shared';
import { invoke } from '@tauri-apps/api/core';

/** What the list shows: names and times only. */
export interface Summary {
  id: string;
  name: string;
  /** RFC 3339, UTC. */
  submitted_at: string;
  /** Set once staff copied it into the EMR. Deleting it is a separate step. */
  entered_at: string | null;
}

export async function listWaiting(): Promise<Summary[]> {
  return invoke<Summary[]>('list_waiting');
}

export async function getSubmission(id: string): Promise<Submission | null> {
  return invoke<Submission | null>('get_submission', { id });
}

/**
 * Stamps the record as copied into the EMR. It stays on this computer — nothing
 * leaves disk until a staff member deletes it.
 *
 * False when the record had already gone, deleted on another look.
 */
export async function markEntered(id: string): Promise<boolean> {
  return invoke<boolean>('mark_entered', { id });
}

/**
 * Irreversible. Returns how many of the ids were actually still there.
 *
 * Rejects when the change could not be written to disk. The records are still
 * held in that case, so the caller has to say so rather than report a success.
 */
export async function deleteSubmissions(ids: string[]): Promise<number> {
  return invoke<number>('delete_submissions', { ids });
}

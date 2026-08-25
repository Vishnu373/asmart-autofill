import type { Submission } from '@asmart/shared';

/** What `GET /api/pending` returns, names and times only. */
export interface Waiting {
  id: string;
  name: string;
  submitted_at: string;
}

/** What `GET /api/mapping` serves, as `mapping.json` on disk. */
export interface Mapping {
  emr: string;
  version: number;
  fields: Partial<Record<keyof Submission, string>>;
  save_button: string;
}

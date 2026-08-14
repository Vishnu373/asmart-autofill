-- Up Migration

CREATE TABLE submissions (
  -- The tablet supplies this id so a double tap on Submit is one row.
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'DONE', 'DELETED')),
  -- Emptied to '{}' once the submission is DONE or DELETED.
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  entered_at timestamptz
);

-- The waiting list.
CREATE INDEX submissions_clinic_id_status_idx ON submissions (clinic_id, status);

-- The two-hour cleanup scan.
CREATE INDEX submissions_status_submitted_at_idx ON submissions (status, submitted_at);

-- Down Migration

DROP TABLE submissions;

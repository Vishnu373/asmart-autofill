-- Up Migration

CREATE TABLE clinics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  auth_user_id text NOT NULL UNIQUE,
  emr text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Signup must reject a second clinic on the same address whatever its casing.
CREATE UNIQUE INDEX clinics_lower_email_key ON clinics (lower(email));

-- Down Migration

DROP TABLE clinics;

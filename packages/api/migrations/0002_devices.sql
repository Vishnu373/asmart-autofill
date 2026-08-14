-- Up Migration

CREATE TABLE devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('desktop', 'tablet')),
  device_label text,
  token_hash text,
  linked_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz
);

CREATE INDEX devices_clinic_id_idx ON devices (clinic_id);

-- Tablet auth looks a device up by the hash of the secret in its link.
CREATE UNIQUE INDEX devices_token_hash_key ON devices (token_hash)
  WHERE token_hash IS NOT NULL;

-- Down Migration

DROP TABLE devices;

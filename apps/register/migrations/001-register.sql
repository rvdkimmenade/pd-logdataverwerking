CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE SCHEMA IF NOT EXISTS register;
CREATE TABLE register.activities (
  id uuid PRIMARY KEY,
  party text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE register.versions (
  activity_id uuid NOT NULL REFERENCES register.activities(id),
  version integer NOT NULL CHECK (version > 0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  contributors text[] NOT NULL,
  published_by text,
  PRIMARY KEY (activity_id, version),
  CHECK (valid_until IS NULL OR valid_until > valid_from),
  CHECK ((status = 'draft' AND published_by IS NULL) OR
    (status = 'published' AND published_by IS NOT NULL AND NOT published_by = ANY(contributors))),
  EXCLUDE USING gist (activity_id WITH =, tstzrange(valid_from, valid_until, '[)') WITH &&)
    WHERE (status = 'published')
);

BEGIN;
CREATE SCHEMA IF NOT EXISTS example;
CREATE TABLE IF NOT EXISTS example.migrations(version integer PRIMARY KEY);
CREATE TABLE IF NOT EXISTS example.cases (
  id uuid PRIMARY KEY,
  case_id text UNIQUE NOT NULL CHECK (case_id ~ '^example-case-not-real-[0-9]{3}$'),
  trace_id text NOT NULL CHECK (trace_id ~ '^[0-9a-f]{32}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS example.outbox (
  id uuid PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES example.cases(id),
  payload jsonb NOT NULL,
  traceparent text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','retry','blocked','delivered')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_until timestamptz,
  error_code text CHECK (error_code IN ('TRANSPORT','RETRYABLE_HTTP','PERMANENT_HTTP','INVALID_RECEIPT')),
  receipt_event_id uuid,
  delivered_at timestamptz,
  CHECK ((lease_token IS NULL) = (lease_until IS NULL)),
  CHECK ((state = 'delivered') = (receipt_event_id IS NOT NULL AND delivered_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS outbox_ready ON example.outbox(next_attempt,created_at) WHERE state IN ('pending','retry');
CREATE OR REPLACE FUNCTION example.protect_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.case_id IS DISTINCT FROM OLD.case_id OR
     NEW.payload IS DISTINCT FROM OLD.payload OR NEW.traceparent IS DISTINCT FROM OLD.traceparent OR
     NEW.created_at IS DISTINCT FROM OLD.created_at OR OLD.state = 'delivered' THEN
    RAISE EXCEPTION 'Immutable outbox event' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER immutable_event BEFORE UPDATE ON example.outbox FOR EACH ROW EXECUTE FUNCTION example.protect_event();
INSERT INTO example.migrations VALUES(1) ON CONFLICT DO NOTHING;
COMMIT;

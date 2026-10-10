BEGIN;
CREATE SCHEMA IF NOT EXISTS ingest;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
CREATE TABLE IF NOT EXISTS ingest.receipts (
  source_application text NOT NULL,
  responsible_party text NOT NULL,
  idempotency_key uuid NOT NULL,
  payload_hash text NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
  event_id uuid NOT NULL UNIQUE,
  received_at timestamptz NOT NULL,
  accepted_at timestamptz,
  PRIMARY KEY(source_application,responsible_party,idempotency_key)
);
CREATE OR REPLACE FUNCTION ingest.protect_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD.source_application,OLD.responsible_party,OLD.idempotency_key,OLD.payload_hash,OLD.event_id,OLD.received_at)
    IS DISTINCT FROM ROW(NEW.source_application,NEW.responsible_party,NEW.idempotency_key,NEW.payload_hash,NEW.event_id,NEW.received_at)
    OR OLD.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Receipt identity is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER protect_receipt BEFORE UPDATE ON ingest.receipts FOR EACH ROW EXECUTE FUNCTION ingest.protect_receipt();
COMMIT;

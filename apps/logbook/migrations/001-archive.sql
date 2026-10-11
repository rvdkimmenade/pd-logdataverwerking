BEGIN;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA IF NOT EXISTS logbook;
CREATE TABLE IF NOT EXISTS logbook.records (
  event_id uuid PRIMARY KEY,
  source_application text NOT NULL,
  responsible_party text NOT NULL,
  trace_id text NOT NULL,
  span_id text NOT NULL,
  processing_activity_id text NOT NULL,
  event_time bigint NOT NULL,
  envelope jsonb NOT NULL,
  original bytea NOT NULL,
  original_sha256 text NOT NULL,
  canonical_sha256 text NOT NULL,
  stored_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  source_topic text NOT NULL,
  source_partition integer NOT NULL,
  source_offset bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS records_trace ON logbook.records(responsible_party,trace_id);
CREATE INDEX IF NOT EXISTS records_span ON logbook.records(responsible_party,span_id);
CREATE INDEX IF NOT EXISTS records_activity ON logbook.records(responsible_party,processing_activity_id);
CREATE OR REPLACE FUNCTION logbook.deny_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Logbook is append-only' USING ERRCODE='55000'; END $$;
CREATE OR REPLACE TRIGGER immutable_records BEFORE UPDATE OR DELETE ON logbook.records FOR EACH ROW EXECUTE FUNCTION logbook.deny_mutation();
CREATE OR REPLACE TRIGGER no_truncate BEFORE TRUNCATE ON logbook.records FOR EACH STATEMENT EXECUTE FUNCTION logbook.deny_mutation();
CREATE OR REPLACE FUNCTION logbook.store_record(doc jsonb, raw_value bytea, canonical_hash text, topic text, partition_id integer, offset_id bigint)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,logbook AS $$
DECLARE existing_hash text;
BEGIN
  IF convert_from(raw_value,'UTF8')::jsonb IS DISTINCT FROM doc OR canonical_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid archive input' USING ERRCODE='22023';
  END IF;
  INSERT INTO logbook.records(event_id,source_application,responsible_party,trace_id,span_id,processing_activity_id,event_time,envelope,original,original_sha256,canonical_sha256,source_topic,source_partition,source_offset)
  VALUES((doc->>'event_id')::uuid,doc->>'source_application',doc->>'responsible_party',doc#>>'{payload,trace_id}',doc#>>'{payload,span_id}',doc#>>'{payload,attributes,dpl.core.processing_activity_id}',(doc#>>'{payload,start_time}')::bigint,doc,raw_value,encode(sha256(raw_value),'hex'),canonical_hash,topic,partition_id,offset_id)
  ON CONFLICT(event_id) DO NOTHING;
  IF FOUND THEN RETURN 'stored'; END IF;
  SELECT canonical_sha256 INTO existing_hash FROM logbook.records WHERE event_id=(doc->>'event_id')::uuid;
  IF existing_hash=canonical_hash THEN RETURN 'duplicate'; END IF;
  RETURN 'conflict';
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA logbook FROM PUBLIC;
COMMIT;

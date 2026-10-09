CREATE TABLE register.audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  party text NOT NULL,
  actor text NOT NULL,
  action text NOT NULL,
  activity_id uuid,
  version integer
);
CREATE FUNCTION register.protect_published() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'Published version is immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_publication BEFORE UPDATE OR DELETE ON register.versions
  FOR EACH ROW EXECUTE FUNCTION register.protect_published();
CREATE FUNCTION register.protect_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit is append-only' USING ERRCODE = '55000';
END $$;
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON register.audit
  FOR EACH ROW EXECUTE FUNCTION register.protect_audit();

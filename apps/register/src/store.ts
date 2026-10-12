import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

export interface Actor {
  id: string;
  role: 'editor' | 'reviewer' | 'reader';
  roles?: ('editor' | 'reviewer' | 'reader')[];
  party: string;
}
export interface Draft {
  content: Record<string, unknown>;
  valid_from: string;
  valid_until: string | null;
}
export class RegisterError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
function version(row: Record<string, unknown>) {
  return {
    activity_id: row.activity_id,
    version: row.version,
    revision: row.revision,
    status: row.status,
    content: row.content,
    valid_from: (row.valid_from as Date).toISOString(),
    valid_until: row.valid_until
      ? (row.valid_until as Date).toISOString()
      : null,
  };
}
export class Store {
  constructor(public pool: Pool) {}
  async audit(
    actor: Actor,
    action: string,
    id: string | null = null,
    number: number | null = null,
    db: Pool | PoolClient = this.pool,
  ) {
    await db.query(
      'INSERT INTO register.audit(party,actor,action,activity_id,version) VALUES($1,$2,$3,$4,$5)',
      [actor.party, actor.id, action, id, number],
    );
  }
  async transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      const result = await run(db);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }
  async list(actor: Actor) {
    const result = await this.pool.query(
      `SELECT a.id,a.party,(SELECT content->>'name' FROM register.versions WHERE activity_id=a.id ORDER BY version DESC LIMIT 1) AS name,
      count(*)::int AS version_count,count(*) FILTER(WHERE v.status='draft')::int AS draft_count
      FROM register.activities a JOIN register.versions v ON v.activity_id=a.id WHERE a.party=$1 GROUP BY a.id ORDER BY a.created_at DESC LIMIT 200`,
      [actor.party],
    );
    return result.rows.map((row) => ({
      ...row,
      processing_activity_id: `urn:uuid:${row.id}`,
    }));
  }
  async find(db: Pool | PoolClient, actor: Actor, id: string, lock = false) {
    const result = await db.query(
      'SELECT id,party FROM register.activities WHERE id=$1 AND party=$2',
      [id, actor.party],
    );
    if (!result.rowCount) throw new RegisterError(404, 'NOT_FOUND');
    if (lock)
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        id,
      ]);
    return result.rows[0];
  }
  async detail(actor: Actor, id: string) {
    const activity = await this.find(this.pool, actor, id);
    const result = await this.pool.query(
      'SELECT * FROM register.versions WHERE activity_id=$1 ORDER BY version DESC',
      [id],
    );
    return {
      ...activity,
      processing_activity_id: `urn:uuid:${id}`,
      versions: result.rows.map(version),
    };
  }
  async create(actor: Actor, draft: Draft) {
    const id = randomUUID();
    await this.transaction(async (db) => {
      await db.query(
        'INSERT INTO register.activities(id,party) VALUES($1,$2)',
        [id, actor.party],
      );
      await this.insert(db, actor, id, 1, draft);
    });
    return this.detail(actor, id);
  }
  async insert(
    db: PoolClient,
    actor: Actor,
    id: string,
    number: number,
    draft: Draft,
  ) {
    const result = await db.query(
      `INSERT INTO register.versions(activity_id,version,content,valid_from,valid_until,contributors)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        id,
        number,
        draft.content,
        draft.valid_from,
        draft.valid_until,
        [actor.id],
      ],
    );
    await this.audit(actor, 'draft.created', id, number, db);
    return version(result.rows[0]);
  }
  async next(actor: Actor, id: string, draft: Draft) {
    return this.transaction(async (db) => {
      await this.find(db, actor, id, true);
      const result = await db.query(
        'SELECT COALESCE(max(version),0)+1 AS next FROM register.versions WHERE activity_id=$1',
        [id],
      );
      return this.insert(db, actor, id, result.rows[0].next, draft);
    });
  }
  async change(
    actor: Actor,
    id: string,
    number: number,
    revision: number,
    draft?: Draft,
  ) {
    return this.transaction(async (db) => {
      await this.find(db, actor, id, true);
      const result = await db.query(
        'SELECT * FROM register.versions WHERE activity_id=$1 AND version=$2 FOR UPDATE',
        [id, number],
      );
      const row = result.rows[0];
      if (!row) throw new RegisterError(404, 'NOT_FOUND');
      if (row.status !== 'draft')
        throw new RegisterError(409, 'IMMUTABLE_PUBLICATION');
      if (row.revision !== revision)
        throw new RegisterError(409, 'STALE_REVISION');
      if (!draft && row.contributors.includes(actor.id))
        throw new RegisterError(403, 'SECOND_PERSON_REQUIRED');
      const updated = draft
        ? await db.query(
            `UPDATE register.versions SET content=$3,valid_from=$4,valid_until=$5,revision=revision+1,
            contributors=ARRAY(SELECT DISTINCT unnest(contributors || $6::text[])) WHERE activity_id=$1 AND version=$2 RETURNING *`,
            [
              id,
              number,
              draft.content,
              draft.valid_from,
              draft.valid_until,
              [actor.id],
            ],
          )
        : await db.query(
            "UPDATE register.versions SET status='published',published_by=$3,revision=revision+1 WHERE activity_id=$1 AND version=$2 RETURNING *",
            [id, number, actor.id],
          );
      await this.audit(
        actor,
        draft ? 'draft.updated' : 'version.published',
        id,
        number,
        db,
      );
      return version(updated.rows[0]);
    });
  }
  async resolve(actor: Actor, id: string, at: string) {
    await this.find(this.pool, actor, id);
    const result = await this.pool.query(
      "SELECT * FROM register.versions WHERE activity_id=$1 AND status='published' AND valid_from <= $2::timestamptz AND (valid_until IS NULL OR valid_until > $2::timestamptz)",
      [id, at],
    );
    if (!result.rowCount) throw new RegisterError(404, 'NO_VALID_VERSION');
    return version(result.rows[0]);
  }
}

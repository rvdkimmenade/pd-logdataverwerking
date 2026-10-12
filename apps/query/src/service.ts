import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { LdvEnvelope } from '@ldv/domain';
import { SearchClient } from './search-client.js';
import { Cursor, QueryError } from './cursor.js';
import { RegisterClient } from './register-client.js';
import { alias, project } from './projector.js';
import { validateSearch, validateItem } from './validation.js';
export interface Scope {
  id: string;
  party: string;
  applications: string[];
  read: boolean;
}
export interface Filters {
  event_id?: string;
  trace_id?: string;
  span_id?: string;
  from?: number;
  until?: number;
  source_application?: string;
  processing_activity_id?: string;
  subject_id?: string;
  limit?: number;
  cursor?: string;
}
interface Row {
  event_id: string;
  responsible_party: string;
  source_application: string;
  envelope: LdvEnvelope;
  original: Buffer;
  original_sha256: string;
  stored_at: Date;
}
interface Hit {
  _id: string;
  sort: [number, string];
}
export class QueryService {
  readonly cursor: Cursor;
  constructor(
    private pool: Pool,
    private client: SearchClient,
    private register: RegisterClient,
    key: string,
  ) {
    this.cursor = new Cursor(key);
  }
  async record(scope: Scope, id: string) {
    const row = (
      await this.pool.query<Row>(
        'SELECT * FROM logbook.records WHERE event_id=$1 AND responsible_party=$2 AND source_application=ANY($3::text[])',
        [id, scope.party, scope.applications],
      )
    ).rows[0];
    if (!row) throw new QueryError(404, 'NOT_FOUND');
    const hash = createHash('sha256').update(row.original).digest('hex');
    if (hash !== row.original_sha256)
      throw new QueryError(503, 'INTEGRITY_FAILED');
    const item = {
      event_id: row.event_id,
      envelope: row.envelope,
      original_base64: row.original.toString('base64'),
      sha256: hash,
      stored_at: row.stored_at.toISOString(),
      processing_activity: await this.register.resolve(
        scope.party,
        row.envelope.payload.attributes['dpl.core.processing_activity_id'],
        row.envelope.payload.start_time,
      ),
    };
    if (!validateItem(item))
      throw new QueryError(503, 'INVALID_ARCHIVE_RESULT');
    return item;
  }
  async search(scope: Scope, input: unknown) {
    if (!validateSearch(input)) throw new QueryError(400, 'INVALID_REQUEST');
    const filters = input as Filters;
    if (
      filters.from !== undefined &&
      filters.until !== undefined &&
      filters.from >= filters.until
    )
      throw new QueryError(400, 'INVALID_INTERVAL');
    if (
      filters.source_application &&
      !scope.applications.includes(filters.source_application)
    )
      throw new QueryError(403, 'FORBIDDEN');
    const { cursor, ...rest } = filters;
    const limit = filters.limit ?? 25;
    const binding = this.cursor.binding({ scope, filters: { ...rest, limit } });
    const after = cursor ? this.cursor.read(cursor, binding) : undefined;
    const conditions: unknown[] = [
      { term: { responsible_party: scope.party } },
      { terms: { source_application: scope.applications } },
    ];
    for (const name of [
      'event_id',
      'trace_id',
      'span_id',
      'source_application',
      'processing_activity_id',
      'subject_id',
    ] as const)
      if (filters[name] !== undefined)
        conditions.push({ term: { [name]: filters[name] } });
    if (filters.from !== undefined || filters.until !== undefined)
      conditions.push({
        range: {
          event_time: {
            ...(filters.from !== undefined ? { gte: filters.from } : {}),
            ...(filters.until !== undefined ? { lt: filters.until } : {}),
          },
        },
      });
    const response = await this.client.call<{ hits: { hits: Hit[] } }>(
      'POST',
      `/${alias}/_search`,
      {
        size: limit + 1,
        _source: false,
        track_total_hits: false,
        sort: [{ event_time: 'asc' }, { event_id: 'asc' }],
        query: { bool: { filter: conditions } },
        ...(after ? { search_after: after } : {}),
      },
    );
    const hits = response.hits.hits;
    const selected = hits.slice(0, limit);
    const items = [];
    for (const hit of selected) {
      let item;
      try {
        item = await this.record(scope, hit._id);
      } catch (e) {
        if (e instanceof QueryError && e.status === 404)
          throw new QueryError(503, 'PROJECTION_MISMATCH');
        throw e;
      }
      const projected = project({ envelope: item.envelope });
      if (
        hit.sort[0] !== projected.event_time ||
        hit.sort[1] !== projected.event_id
      )
        throw new QueryError(503, 'PROJECTION_MISMATCH');
      for (const name of [
        'event_id',
        'trace_id',
        'span_id',
        'source_application',
        'processing_activity_id',
        'subject_id',
      ] as const)
        if (filters[name] !== undefined && projected[name] !== filters[name])
          throw new QueryError(503, 'PROJECTION_MISMATCH');
      if (
        (filters.from !== undefined && projected.event_time < filters.from) ||
        (filters.until !== undefined && projected.event_time >= filters.until)
      )
        throw new QueryError(503, 'PROJECTION_MISMATCH');
      items.push(item);
    }
    return {
      items,
      next_cursor:
        hits.length > limit
          ? this.cursor.issue(selected.at(-1)!.sort, binding)
          : null,
    };
  }
}

import { QueryError } from './cursor.js';
export interface RegisterConfig {
  origin: string;
  readers: Record<string, string>;
}
export class RegisterClient {
  private sessions = new Map<string, { cookie: string; until: number }>();
  constructor(private config: RegisterConfig) {
    const url = new URL(config.origin);
    if (
      url.protocol !== 'http:' ||
      url.hostname !== '127.0.0.1' ||
      url.pathname !== '/'
    )
      throw new Error('Local register required');
  }
  private async login(party: string) {
    const code = this.config.readers[party];
    if (!code) throw new QueryError(503, 'REGISTER_UNAVAILABLE');
    const res = await fetch(`${this.config.origin}/api/session`, {
      method: 'POST',
      headers: {
        Origin: this.config.origin,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ code }),
      signal: AbortSignal.timeout(3000),
      redirect: 'error',
    });
    const actor = (await res.json()) as { party: string; role: string };
    const cookie = res.headers.get('set-cookie')?.split(';')[0];
    if (!res.ok || !cookie || actor.party !== party || actor.role !== 'reader')
      throw new QueryError(503, 'REGISTER_UNAVAILABLE');
    this.sessions.set(party, { cookie, until: Date.now() + 25 * 60000 });
    return cookie;
  }
  async resolve(
    party: string,
    id: string,
    time: number,
  ): Promise<Record<string, unknown>> {
    const match =
      /^urn:uuid:([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.exec(
        id,
      );
    if (!match) return { status: 'unsupported_id' };
    try {
      const session = this.sessions.get(party);
      let cookie =
        session && session.until > Date.now()
          ? session.cookie
          : await this.login(party);
      const get = () =>
        fetch(
          `${this.config.origin}/api/activities/${match[1]}/resolve?at=${encodeURIComponent(new Date(time).toISOString())}`,
          {
            headers: { Cookie: cookie },
            signal: AbortSignal.timeout(3000),
            redirect: 'error',
          },
        );
      let res = await get();
      if (res.status === 401) {
        cookie = await this.login(party);
        res = await get();
      }
      if (res.status === 404) return { status: 'not_found' };
      if (!res.ok) throw new Error();
      const body = (await res.json()) as Record<string, unknown>;
      if (body.status !== 'published') throw new Error();
      return {
        status: 'resolved',
        version: body.version,
        valid_from: body.valid_from,
        valid_until: body.valid_until,
        content: body.content,
      };
    } catch {
      throw new QueryError(503, 'REGISTER_UNAVAILABLE');
    }
  }
}

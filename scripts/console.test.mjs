import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateKeyPairSync, sign, randomBytes } from 'node:crypto';
import * as oidc from 'openid-client';
import { Sessions } from '../apps/console/dist/auth.js';
import { createApp } from '../apps/console/dist/app.js';

const origin = 'https://127.0.0.1:18087',
  issuer = 'https://idp.example.invalid';
const actor = {
  id: 'synthetic-auditor',
  role: 'reader',
  party: 'synthetic-party',
  permissions: ['log.read', 'log.export'],
  applications: ['synthetic-app'],
  backend: 'scoped',
};
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
function fixture(change = {}, key = keys.privateKey, alg = 'RS256') {
  const config = new oidc.Configuration(
    {
      issuer,
      authorization_endpoint: issuer + '/authorize',
      token_endpoint: issuer + '/token',
      jwks_uri: issuer + '/jwks',
    },
    'console',
    {
      client_secret: randomBytes(32).toString('hex'),
      id_token_signed_response_alg: 'RS256',
    },
  );
  oidc.enableNonRepudiationChecks(config);
  let nonce;
  const token = vi.fn();
  config[oidc.customFetch] = async (url, options) => {
    if (new URL(url).pathname === '/jwks')
      return Response.json({
        keys: [
          {
            ...keys.publicKey.export({ format: 'jwk' }),
            kid: 'test',
            alg: 'RS256',
            use: 'sig',
          },
        ],
      });
    const body = new URLSearchParams(options.body);
    expect(body.get('code_verifier')).toBeTruthy();
    token();
    const now = Math.floor(Date.now() / 1000);
    const head = Buffer.from(JSON.stringify({ alg, kid: 'test' })).toString(
      'base64url',
    );
    const payload = Buffer.from(
      JSON.stringify({
        iss: issuer,
        aud: 'console',
        sub: 'known',
        iat: now,
        exp: now + 300,
        nonce,
        ...change,
      }),
    ).toString('base64url');
    const signature = sign(
      'RSA-SHA256',
      Buffer.from(head + '.' + payload),
      key,
    ).toString('base64url');
    return Response.json({
      access_token: randomBytes(24).toString('hex'),
      token_type: 'Bearer',
      expires_in: 300,
      id_token: head + '.' + payload + '.' + signature,
    });
  };
  const sessions = new Sessions(config, origin, { known: actor });
  return {
    sessions,
    token,
    async start() {
      const flow = await sessions.begin();
      const url = new URL(flow.url);
      nonce = url.searchParams.get('nonce');
      return {
        flow,
        req: {
          url:
            '/auth/callback?code=synthetic&state=' +
            url.searchParams.get('state'),
          headers: { cookie: flow.cookie.split(';')[0] },
        },
      };
    },
  };
}
afterEach(() => vi.useRealTimers());
describe('Console OIDC boundary', () => {
  it('uses unique S256 PKCE, state, nonce and browser transaction cookies', async () => {
    const f = fixture(),
      a = await f.start(),
      b = await f.start();
    const url = new URL(a.flow.url);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('openid');
    expect(url.searchParams.get('prompt')).toBe('login');
    expect(url.searchParams.get('code_challenge')).toHaveLength(43);
    expect(a.flow.cookie).not.toBe(b.flow.cookie);
    expect(a.flow.url).not.toBe(b.flow.url);
    expect(a.flow.cookie).toContain('Secure; HttpOnly; SameSite=Lax');
  });
  it('validates signed ID token and produces only a short lived opaque session', async () => {
    const f = fixture(),
      { req } = await f.start(),
      result = await f.sessions.finish(req);
    expect(result.actor).toEqual(actor);
    expect(result.cookie).toContain('__Host-ldv-console=');
    expect(result.cookie).not.toContain('eyJ');
    expect(f.sessions.actor({ headers: { cookie: result.cookie } })).toEqual(
      actor,
    );
    f.sessions.logout({ headers: { cookie: result.cookie } });
    expect(() =>
      f.sessions.actor({ headers: { cookie: result.cookie } }),
    ).toThrow('AUTH_REQUIRED');
  });
  for (const [name, claims, key, alg] of [
    ['wrong issuer', { iss: 'https://foreign.example.invalid' }],
    ['wrong audience', { aud: 'other' }],
    ['expired token', { exp: 1 }],
    ['wrong nonce', { nonce: 'wrong' }],
    ['unknown identity', { sub: 'unknown' }],
    ['invalid signature', {}, other.privateKey],
    ['disallowed algorithm', {}, keys.privateKey, 'HS256'],
  ])
    it('rejects ' + name, async () => {
      const f = fixture(claims, key, alg),
        { req } = await f.start();
      await expect(f.sessions.finish(req)).rejects.toThrow(
        name === 'unknown identity' ? 'FORBIDDEN' : 'AUTH_REQUIRED',
      );
    });
  it('rejects missing browser cookie, wrong state and callback replay', async () => {
    const f = fixture(),
      a = await f.start();
    await expect(f.sessions.finish({ ...a.req, headers: {} })).rejects.toThrow(
      'AUTH_REQUIRED',
    );
    await expect(
      f.sessions.finish({
        ...a.req,
        url: '/auth/callback?code=synthetic&state=wrong',
      }),
    ).rejects.toThrow('AUTH_REQUIRED');
    await expect(f.sessions.finish(a.req)).rejects.toThrow('AUTH_REQUIRED');
    expect(f.token).not.toHaveBeenCalled();
  });
  it('expires pending transactions and sessions with the ID token', async () => {
    vi.useFakeTimers();
    const f = fixture(),
      a = await f.start();
    vi.setSystemTime(Date.now() + 301000);
    await expect(f.sessions.finish(a.req)).rejects.toThrow('AUTH_REQUIRED');
    const b = await f.start(),
      result = await f.sessions.finish(b.req);
    vi.setSystemTime(Date.now() + 301000);
    expect(() =>
      f.sessions.actor({ headers: { cookie: result.cookie } }),
    ).toThrow('AUTH_REQUIRED');
  });
});
describe('Console API permissions and failures', () => {
  async function appFor(
    who = actor,
    audit = vi.fn(),
    query = vi.fn(async () => ({
      status: 200,
      body: { items: [], next_cursor: null },
    })),
  ) {
    const sessions = {
      actor: (req) => {
        if (req.headers.cookie !== 'test=known')
          throw Object.assign(new Error('AUTH_REQUIRED'), {
            status: 401,
            code: 'AUTH_REQUIRED',
          });
        return who;
      },
      logout: vi.fn(),
    };
    const app = await createApp({
      pool: { query: vi.fn(async () => ({ rows: [] })) },
      origin,
      tls: {},
      sessions,
      audit,
      query,
    });
    const request = (url, method = 'GET', payload) =>
      app.inject({
        url,
        method,
        headers: {
          host: new URL(origin).host,
          origin,
          cookie: 'test=known',
          'x-role': 'editor',
          'x-responsible-party': 'foreign',
        },
        ...(payload === undefined ? {} : { payload }),
      });
    return { app, request, audit, query };
  }
  it('does not grant logbook access to register managers or technical users', async () => {
    for (const permissions of [['register'], ['operations'], []]) {
      const f = await appFor({ ...actor, role: 'editor', permissions });
      try {
        expect(
          (await f.request('/api/logs/search', 'POST', {})).statusCode,
        ).toBe(403);
        expect(f.query).not.toHaveBeenCalled();
      } finally {
        await f.app.close();
      }
    }
  });
  it('requires a separate export right and denies direct register and ops access', async () => {
    const f = await appFor({ ...actor, permissions: ['log.read'] });
    try {
      for (const url of ['/api/activities', '/api/operations'])
        expect((await f.request(url)).statusCode).toBe(403);
      expect((await f.request('/api/logs/export', 'POST', {})).statusCode).toBe(
        403,
      );
    } finally {
      await f.app.close();
    }
  });
  it('audits before queries and exports, binds scope to session and rejects code fallback', async () => {
    const f = await appFor();
    try {
      expect(
        (
          await f.request('/api/logs/search', 'POST', {
            subject_id: 'synthetic-search',
          })
        ).statusCode,
      ).toBe(200);
      expect(f.query.mock.calls[0][0]).toEqual(actor);
      expect(f.audit.mock.calls[0]).toEqual([actor, 'search']);
      expect(JSON.stringify(f.audit.mock.calls)).not.toContain(
        'synthetic-search',
      );
      const exported = await f.request('/api/logs/export', 'POST', {});
      expect(exported.statusCode).toBe(200);
      expect(exported.headers['content-disposition']).toContain('attachment');
      expect(exported.json().responsible_party).toBe(actor.party);
      expect(exported.headers['cache-control']).toBe('no-store');
      expect(
        (await f.request('/api/session', 'POST', { code: 'fake' })).statusCode,
      ).toBe(403);
    } finally {
      await f.app.close();
    }
  });
  it('denies missing sessions, forged host/origin and treats audit/backend outage as 503', async () => {
    const f = await appFor();
    try {
      expect(
        (
          await f.app.inject({
            url: '/api/me',
            headers: { host: new URL(origin).host },
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (
          await f.app.inject({
            url: '/api/logs/search',
            method: 'POST',
            headers: {
              host: new URL(origin).host,
              origin: 'https://foreign.invalid',
              cookie: 'test=known',
            },
            payload: {},
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await f.app.inject({
            url: '/api/me',
            headers: { host: 'foreign.invalid', cookie: 'test=known' },
          })
        ).statusCode,
      ).toBe(403);
    } finally {
      await f.app.close();
    }
    const failed = await appFor(
      actor,
      vi.fn(async () => {
        throw new Error('synthetic-audit-failure');
      }),
    );
    try {
      const result = await failed.request('/api/logs/search', 'POST', {});
      expect(result.statusCode).toBe(503);
      expect(failed.query).not.toHaveBeenCalled();
      expect(result.body).not.toContain('synthetic-audit-failure');
    } finally {
      await failed.app.close();
    }
    const down = await appFor(
      actor,
      vi.fn(),
      vi.fn(async () => {
        throw new Error('synthetic-backend-failure');
      }),
    );
    try {
      const result = await down.request('/api/logs/search', 'POST', {});
      expect(result.statusCode).toBe(503);
      expect(result.body).not.toContain('synthetic-backend-failure');
    } finally {
      await down.app.close();
    }
  });
});

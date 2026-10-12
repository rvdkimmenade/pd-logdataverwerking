import * as oidc from 'openid-client';
import type { FastifyRequest } from 'fastify';
import { request } from 'node:https';

export interface Identity {
  id: string;
  party: string;
  role: 'editor' | 'reviewer' | 'reader';
  permissions: ('register' | 'log.read' | 'log.export' | 'operations')[];
  applications: string[];
  backend: string;
}
export class AuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
function cookie(req: FastifyRequest, name: string) {
  return req.headers.cookie
    ?.split(';')
    .map((x) => x.trim())
    .find((x) => x.startsWith(name + '='))
    ?.slice(name.length + 1);
}
export class Sessions {
  private pending = new Map<
    string,
    { state: string; nonce: string; verifier: string; expires: number }
  >();
  private sessions = new Map<string, { actor: Identity; expires: number }>();
  constructor(
    private config: oidc.Configuration,
    private origin: string,
    private identities: Record<string, Identity>,
  ) {}
  static async create(
    issuer: string,
    clientId: string,
    secret: string,
    origin: string,
    identities: Record<string, Identity>,
    ca?: string,
  ) {
    if (
      !/^https:\/\/127\.0\.0\.1:\d+$/.test(origin) ||
      !issuer.startsWith('https:') ||
      !secret ||
      !Object.keys(identities).length
    )
      throw new Error('OIDC_CONFIGURATION_REQUIRED');
    for (const actor of Object.values(identities)) {
      if (
        !actor.id ||
        !actor.party ||
        !['editor', 'reviewer', 'reader'].includes(actor.role) ||
        !actor.applications.length ||
        !actor.backend ||
        actor.permissions.some(
          (p) =>
            !['register', 'log.read', 'log.export', 'operations'].includes(p),
        )
      )
        throw new Error('OIDC_SCOPE_REQUIRED');
    }
    const config = await oidc.discovery(
      new URL(issuer),
      clientId,
      { client_secret: secret, id_token_signed_response_alg: 'RS256' },
      undefined,
      {
        execute: [oidc.enableNonRepudiationChecks],
        timeout: 5,
        ...(ca
          ? {
              [oidc.customFetch]: async (
                url: string | URL,
                init: Parameters<oidc.CustomFetch>[1],
              ) => {
                const target = new URL(url);
                if (
                  target.origin !== new URL(issuer).origin ||
                  target.protocol !== 'https:'
                )
                  throw new Error('OIDC_ENDPOINT_ORIGIN_REQUIRED');
                return new Promise<Response>((resolve, reject) => {
                  const req = request(
                    target,
                    {
                      method: init?.method ?? 'GET',
                      headers: Object.fromEntries(
                        new Headers(init?.headers).entries(),
                      ),
                      ca,
                      rejectUnauthorized: true,
                    },
                    (res) => {
                      let text = '';
                      res.on('data', (chunk) => {
                        text += chunk;
                        if (text.length > 2000000)
                          req.destroy(new Error('OIDC response too large'));
                      });
                      res.on('error', () =>
                        reject(new Error('OIDC unavailable')),
                      );
                      res.on('end', () =>
                        resolve(
                          new Response(text, {
                            status: res.statusCode ?? 503,
                            headers: Object.entries(res.headers).flatMap(
                              ([key, value]) =>
                                value === undefined
                                  ? []
                                  : [
                                      [
                                        key,
                                        Array.isArray(value)
                                          ? value.join(',')
                                          : value,
                                      ] as [string, string],
                                    ],
                            ),
                          }),
                        ),
                      );
                    },
                  );
                  req.setTimeout(5000, () =>
                    req.destroy(new Error('OIDC timed out')),
                  );
                  req.on('error', () => reject(new Error('OIDC unavailable')));
                  req.end(
                    init?.body instanceof URLSearchParams
                      ? init.body.toString()
                      : typeof init?.body === 'string'
                        ? init.body
                        : undefined,
                  );
                });
              },
            }
          : {}),
      },
    );
    return new Sessions(config, origin, identities);
  }
  private prune() {
    for (const map of [this.pending, this.sessions])
      for (const [key, value] of map)
        if (value.expires <= Date.now()) map.delete(key);
  }
  async begin() {
    this.prune();
    if (this.pending.size >= 1000) throw new AuthError(503, 'UNAVAILABLE');
    const state = oidc.randomState(),
      nonce = oidc.randomNonce(),
      verifier = oidc.randomPKCECodeVerifier(),
      browser = oidc.randomState();
    this.pending.set(browser, {
      state,
      nonce,
      verifier,
      expires: Date.now() + 300000,
    });
    const url = oidc.buildAuthorizationUrl(this.config, {
      redirect_uri: this.origin + '/auth/callback',
      response_type: 'code',
      scope: 'openid',
      prompt: 'login',
      state,
      nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
    });
    return {
      url: url.href,
      cookie: `__Host-ldv-login=${browser}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=300`,
    };
  }
  async finish(req: FastifyRequest) {
    this.prune();
    const browser = cookie(req, '__Host-ldv-login');
    const flow = browser ? this.pending.get(browser) : undefined;
    if (browser) this.pending.delete(browser);
    if (!flow) throw new AuthError(401, 'AUTH_REQUIRED');
    try {
      const tokens = await oidc.authorizationCodeGrant(
        this.config,
        new URL(req.url, this.origin),
        {
          pkceCodeVerifier: flow.verifier,
          expectedState: flow.state,
          expectedNonce: flow.nonce,
          idTokenExpected: true,
        },
      );
      const claims = tokens.claims();
      const actor = claims?.sub ? this.identities[claims.sub] : undefined;
      if (!actor) throw new AuthError(403, 'FORBIDDEN');
      const expires = Math.min(
        Date.now() + 1800000,
        Number(claims!.exp) * 1000,
      );
      if (!Number.isFinite(expires) || expires <= Date.now())
        throw new AuthError(401, 'AUTH_REQUIRED');
      if (this.sessions.size >= 1000) throw new AuthError(503, 'UNAVAILABLE');
      const token = oidc.randomState();
      this.sessions.set(token, { actor, expires });
      return {
        actor,
        cookie: `__Host-ldv-console=${token}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor((expires - Date.now()) / 1000)}`,
      };
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError(401, 'AUTH_REQUIRED');
    }
  }
  actor(req: FastifyRequest): Identity {
    this.prune();
    const token = cookie(req, '__Host-ldv-console');
    const value = token ? this.sessions.get(token) : undefined;
    if (!value) throw new AuthError(401, 'AUTH_REQUIRED');
    return value.actor;
  }
  logout(req: FastifyRequest) {
    const token = cookie(req, '__Host-ldv-console');
    if (token) this.sessions.delete(token);
  }
}

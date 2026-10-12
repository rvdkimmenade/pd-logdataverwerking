import { request } from 'node:https';
import type { ConnectionOptions } from 'node:tls';
export interface SearchConfig {
  port: number;
  tls: ConnectionOptions;
}
export class SearchError extends Error {
  constructor(
    readonly status: number,
    readonly permission?: string,
  ) {
    super('Search dependency failed');
  }
}
export class SearchClient {
  constructor(private config: SearchConfig) {
    if (
      !config.tls.ca ||
      !config.tls.cert ||
      !config.tls.key ||
      config.tls.rejectUnauthorized === false
    )
      throw new Error('Verified mTLS required');
  }
  async call<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
    ndjson = false,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: this.config.port,
          path,
          method,
          ...this.config.tls,
          rejectUnauthorized: true,
          headers: {
            'content-type': ndjson
              ? 'application/x-ndjson'
              : 'application/json',
          },
        },
        (res) => {
          let text = '';
          res.on('data', (b) => {
            text += b;
            if (text.length > 16_000_000) req.destroy(new SearchError(503));
          });
          res.on('error', () => reject(new SearchError(503)));
          res.on('end', () => {
            if (!res.statusCode || res.statusCode >= 300) {
              const permission = /no permissions for \[([a-z_:/*]+)\]/.exec(
                text,
              )?.[1];
              return reject(new SearchError(res.statusCode ?? 503, permission));
            }
            try {
              resolve(text ? JSON.parse(text) : {});
            } catch {
              reject(new SearchError(503));
            }
          });
        },
      );
      const timer = setTimeout(() => req.destroy(new SearchError(503)), 5000);
      req.on('close', () => clearTimeout(timer));
      req.on('error', () => reject(new SearchError(503)));
      req.end(
        body === undefined
          ? undefined
          : ndjson
            ? String(body)
            : JSON.stringify(body),
      );
    });
  }
}

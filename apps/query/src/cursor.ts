import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { canonical } from '@ldv/domain';
export class QueryError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
export class Cursor {
  constructor(private key: string) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Cursor key required');
  }
  binding(value: unknown) {
    return createHash('sha256').update(canonical(value)).digest('hex');
  }
  issue(after: [number, string], binding: string) {
    const text = Buffer.from(
      JSON.stringify({ after, binding, expires: Date.now() + 900000 }),
    ).toString('base64url');
    return `${text}.${createHmac('sha256', this.key).update(text).digest('hex')}`;
  }
  read(token: string, binding: string): [number, string] {
    try {
      const parts = token.split('.');
      const text = parts[0]!,
        signature = parts[1]!;
      const expected = createHmac('sha256', this.key)
        .update(text)
        .digest('hex');
      if (
        parts.length !== 2 ||
        !/^[a-f0-9]{64}$/.test(signature) ||
        !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
      )
        throw new Error();
      const data = JSON.parse(Buffer.from(text, 'base64url').toString());
      if (
        data.binding !== binding ||
        !Number.isFinite(data.expires) ||
        data.expires < Date.now() ||
        !Array.isArray(data.after) ||
        data.after.length !== 2 ||
        !Number.isSafeInteger(data.after[0]) ||
        typeof data.after[1] !== 'string' ||
        !/^[a-f0-9-]{36}$/.test(data.after[1])
      )
        throw new Error();
      return data.after;
    } catch {
      throw new QueryError(400, 'INVALID_CURSOR');
    }
  }
}

import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { assertHealthy } from './infra.mjs';

describe('infrastructure gate', () => {
  const healthy = [
    { Service: 'postgres', State: 'running', Health: 'healthy' },
    { Service: 'kafka', State: 'running', Health: 'healthy' },
  ];
  it('requires every dependency, not only running containers', () => {
    expect(() => assertHealthy(JSON.stringify(healthy))).not.toThrow();
    expect(() => assertHealthy(JSON.stringify(healthy.slice(0, 1)))).toThrow(
      'kafka',
    );
    expect(() => assertHealthy('[]')).toThrow('postgres');
  });
  it('rejects starting and unhealthy containers', () => {
    for (const health of ['starting', 'unhealthy', '']) {
      expect(() =>
        assertHealthy(
          JSON.stringify([healthy[0], { ...healthy[1], Health: health }]),
        ),
      ).toThrow('kafka');
    }
  });
  it('supports Compose line-delimited JSON output', () => {
    expect(() =>
      assertHealthy(healthy.map((row) => JSON.stringify(row)).join('\n')),
    ).not.toThrow();
  });
  it('pins images, protects secrets and exposes no base Compose ports', async () => {
    const base = parse(
      await readFile(new URL('../infra/compose.yaml', import.meta.url), 'utf8'),
    );
    for (const [name, service] of Object.entries(base.services)) {
      expect(service.image).toMatch(/:[0-9.]+@sha256:[a-f0-9]{64}$/);
      expect(service.ports).toBeUndefined();
      if (name !== 'kafka-volume-init')
        expect(service.healthcheck).toBeDefined();
    }
    expect(
      base.services.postgres.environment.POSTGRES_PASSWORD,
    ).toBeUndefined();
    expect(base.services.postgres.environment.POSTGRES_PASSWORD_FILE).toBe(
      '/run/secrets/postgres_password',
    );
    const dev = parse(
      await readFile(
        new URL('../infra/compose.dev.yaml', import.meta.url),
        'utf8',
      ),
    );
    for (const service of Object.values(dev.services)) {
      expect(service.ports.every((port) => port.startsWith('127.0.0.1:'))).toBe(
        true,
      );
    }
  });
});

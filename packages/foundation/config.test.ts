import { describe, expect, it } from 'vitest';
import { readConfig } from './src/config.js';

const demo = { POSTGRES_PASSWORD_FILE: '/synthetic/password-file' };

describe('foundation configuration boundary', () => {
  it('uses loopback and documented local defaults', () => {
    expect(readConfig(demo)).toMatchObject({
      environment: 'local',
      bindAddress: '127.0.0.1',
      postgresPort: 15432,
      kafkaPort: 19092,
    });
  });
  it('accepts explicit test environment and port overrides', () => {
    expect(
      readConfig({ ...demo, LDV_ENV: 'test', POSTGRES_PORT: '25432' })
        .postgresPort,
    ).toBe(25432);
  });
  it.each(['production', 'staging', 'typo', ''])(
    'rejects environment %s',
    (LDV_ENV) => {
      expect(() => readConfig({ ...demo, LDV_ENV })).toThrow(
        'only local or test',
      );
    },
  );
  it('never falls back to local in a production process', () => {
    expect(() => readConfig({ ...demo, NODE_ENV: 'production' })).toThrow(
      'only local or test',
    );
  });
  it.each(['0.0.0.0', '::', '192.168.1.1'])(
    'rejects exposed bind %s',
    (LDV_BIND_ADDRESS) => {
      expect(() => readConfig({ ...demo, LDV_BIND_ADDRESS })).toThrow(
        '127.0.0.1',
      );
    },
  );
  it('requires a secret file without exposing a secret', () => {
    expect(() => readConfig({})).toThrow('POSTGRES_PASSWORD_FILE is required');
  });
  it.each(['0', '-1', '65536', '1.5', 'invalid', ''])(
    'rejects invalid port %s',
    (POSTGRES_PORT) => {
      expect(() => readConfig({ ...demo, POSTGRES_PORT })).toThrow(
        'between 1 and 65535',
      );
    },
  );
});

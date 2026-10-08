export type FoundationConfig = {
  environment: 'local' | 'test';
  bindAddress: '127.0.0.1';
  postgresPort: number;
  kafkaPort: number;
  postgresPasswordFile: string;
};

function port(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  if (!/^[1-9][0-9]*$/.test(value) || Number(value) > 65535) {
    throw new Error(`${name} must be a port between 1 and 65535`);
  }
  return Number(value);
}

export function readConfig(
  env: Record<string, string | undefined>,
): FoundationConfig {
  const environment = env.LDV_ENV ?? 'local';
  if (
    !['local', 'test'].includes(environment) ||
    env.NODE_ENV === 'production'
  ) {
    throw new Error(
      'Foundation commands support only local or test environments',
    );
  }
  if ((env.LDV_BIND_ADDRESS ?? '127.0.0.1') !== '127.0.0.1') {
    throw new Error('Foundation infrastructure must bind to 127.0.0.1');
  }
  if (!env.POSTGRES_PASSWORD_FILE?.trim()) {
    throw new Error('POSTGRES_PASSWORD_FILE is required');
  }
  return {
    environment: environment as 'local' | 'test',
    bindAddress: '127.0.0.1',
    postgresPort: port(env.POSTGRES_PORT, 15432, 'POSTGRES_PORT'),
    kafkaPort: port(env.KAFKA_PORT, 19092, 'KAFKA_PORT'),
    postgresPasswordFile: env.POSTGRES_PASSWORD_FILE,
  };
}

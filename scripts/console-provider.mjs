import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { request } from 'node:https';
import { command } from './process.mjs';
export async function freePort() {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  return port;
}
export async function prepareProvider(ctx, origin, users) {
  if (!ctx.project.startsWith('ldv-ingest-test-'))
    throw new Error('Isolated test required');
  const root = resolve(import.meta.dirname, '..'),
    pki = resolve(ctx.directory, 'pki'),
    directory = resolve(ctx.directory, 'console');
  await mkdir(directory, { recursive: true });
  const name = ctx.project + '-idp',
    configVolume = name + '-config',
    dataVolume = name + '-data',
    port = await freePort();
  const image =
    'quay.io/keycloak/keycloak:26.8.0@sha256:27b3230fbabb8c9ff3c66c864cf09dcd8a41aca82e5100679d109ef0eeb05741';
  command('docker', [
    'run',
    '--rm',
    '--entrypoint',
    'bash',
    '--mount',
    `type=bind,source=${pki},target=/pki`,
    '--mount',
    `type=bind,source=${resolve(root, 'scripts/console-pki.sh')},target=/generate.sh,readonly`,
    'postgres:18.6@sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336',
    '/generate.sh',
  ]);
  const secret = randomBytes(32).toString('hex'),
    issuer = `https://127.0.0.1:${port}/realms/ldv`,
    clientId = 'ldv-console';
  const realm = {
    realm: 'ldv',
    enabled: true,
    sslRequired: 'all',
    registrationAllowed: false,
    resetPasswordAllowed: false,
    rememberMe: false,
    accessTokenLifespan: 300,
    ssoSessionIdleTimeout: 1800,
    clients: [
      {
        clientId,
        enabled: true,
        protocol: 'openid-connect',
        publicClient: false,
        secret,
        standardFlowEnabled: true,
        directAccessGrantsEnabled: false,
        implicitFlowEnabled: false,
        serviceAccountsEnabled: false,
        redirectUris: [origin + '/auth/callback'],
        webOrigins: [],
        attributes: {
          'pkce.code.challenge.method': 'S256',
          'id.token.signed.response.alg': 'RS256',
        },
      },
    ],
    users: users.map((u) => ({
      id: u.id,
      username: u.username,
      enabled: true,
      firstName: 'Synthetic',
      lastName: u.username,
      email: `${u.username}@example.invalid`,
      emailVerified: true,
      credentials: [{ type: 'password', value: u.password, temporary: false }],
    })),
  };
  await writeFile(resolve(directory, 'realm.json'), JSON.stringify(realm), {
    mode: 0o600,
  });
  const ca = await readFile(resolve(pki, 'ca.crt'), 'utf8');
  const cleanup = () => {
    try {
      command('docker', ['rm', '--force', name]);
    } catch {
      /* Container might not have started. */
    }
    for (const volume of [configVolume, dataVolume])
      try {
        command('docker', ['volume', 'rm', volume]);
      } catch {
        /* Volume might not have been created. */
      }
  };
  try {
    command('docker', [
      'run',
      '--rm',
      '--entrypoint',
      'bash',
      '--mount',
      `type=bind,source=${pki},target=/source,readonly`,
      '--mount',
      `type=bind,source=${directory},target=/import-source,readonly`,
      '--volume',
      configVolume + ':/target',
      'postgres:18.6@sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336',
      '-c',
      'install -d -m 700 -o 1000 -g 0 /target/tls /target/import; install -m 600 -o 1000 -g 0 /source/identityprovider.crt /target/tls/identityprovider.crt; install -m 600 -o 1000 -g 0 /source/identityprovider.key /target/tls/identityprovider.key; install -m 600 -o 1000 -g 0 /import-source/realm.json /target/import/realm.json',
    ]);
    command('docker', [
      'run',
      '--detach',
      '--name',
      name,
      '--publish',
      `127.0.0.1:${port}:8443`,
      '--mount',
      `type=volume,source=${configVolume},target=/local-config,readonly`,
      '--mount',
      `type=volume,source=${configVolume},target=/opt/keycloak/data/import,volume-subpath=import,readonly`,
      '--volume',
      dataVolume + ':/opt/keycloak/data',
      image,
      'start',
      `--hostname=https://127.0.0.1:${port}`,
      '--http-enabled=false',
      '--https-certificate-file=/local-config/tls/identityprovider.crt',
      '--https-certificate-key-file=/local-config/tls/identityprovider.key',
      '--import-realm',
    ]);
    const deadline = Date.now() + 120000;
    let ready = false;
    while (Date.now() < deadline) {
      ready = await new Promise((done) => {
        const req = request(
          issuer + '/.well-known/openid-configuration',
          { ca, rejectUnauthorized: true },
          (res) => {
            res.resume();
            res.on('end', () => done(res.statusCode === 200));
          },
        );
        req.on('error', () => done(false));
        req.setTimeout(2000, () => req.destroy());
        req.end();
      });
      if (ready) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!ready) throw new Error('Provider startup timeout');
    return {
      issuer,
      clientId,
      secret,
      ca,
      tls: {
        key: await readFile(resolve(pki, 'console-server.key'), 'utf8'),
        cert: await readFile(resolve(pki, 'console-server.crt'), 'utf8'),
      },
      cleanup,
      name,
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}

import {
  readFile,
  writeFile,
  mkdir,
  copyFile,
  chmod,
  open,
} from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { request } from 'node:https';
import { command, npm } from './process.mjs';
import { prepareIngest } from './ingest-infra.mjs';
const root = resolve(import.meta.dirname, '..'),
  directory = resolve(root, '.local/ldv-console-dev'),
  pki = resolve(root, '.local/ldv-ingest-dev/pki');
const origin = 'https://127.0.0.1:18087',
  issuer = 'https://127.0.0.1:18086/realms/ldv';
const image =
  'quay.io/keycloak/keycloak:26.8.0@sha256:27b3230fbabb8c9ff3c66c864cf09dcd8a41aca82e5100679d109ef0eeb05741';
async function get(url, ca) {
  return new Promise((resolve, reject) => {
    const req = request(url, { ca, rejectUnauthorized: true }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('Timeout')));
    req.end();
  });
}
async function ready(url, ca) {
  try {
    return (await get(url, ca)) === 200;
  } catch {
    return false;
  }
}
async function wait(url, ca, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await ready(url, ca)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Startup timeout');
}
async function main() {
  if (
    process.argv[2] !== 'up' ||
    process.env.NODE_ENV === 'production' ||
    (process.env.LDV_ENV && process.env.LDV_ENV !== 'local')
  )
    throw new Error('Local mode required');
  npm(['run', 'register:up'], { stdio: 'inherit', timeout: 180000 });
  npm(['run', 'query:up'], { stdio: 'inherit', timeout: 300000 });
  await mkdir(resolve(directory, 'tls'), { recursive: true });
  await mkdir(resolve(directory, 'import'), { recursive: true });
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
  for (const ext of ['key', 'crt']) {
    const target = resolve(directory, 'tls', `identityprovider.${ext}`);
    await copyFile(resolve(pki, `identityprovider.${ext}`), target);
    await chmod(target, 0o644);
  }
  const ca = await readFile(resolve(pki, 'ca.crt'), 'utf8');
  let config;
  try {
    config = JSON.parse(
      await readFile(resolve(directory, 'config.json'), 'utf8'),
    );
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const register = JSON.parse(
    await readFile(
      resolve(root, '.local/ldv-register-dev/config.json'),
      'utf8',
    ),
  );
  const query = JSON.parse(
    await readFile(
      resolve(root, '.local/ldv-ingest-dev/query/runtime.json'),
      'utf8',
    ),
  );
  const tls = JSON.parse(
    await readFile(
      resolve(root, '.local/ldv-ingest-dev/query/auditor.json'),
      'utf8',
    ),
  );
  const scope = Object.values(query.scopes).find(
    (s) => s.id === 'demo-auditor',
  );
  if (!config) {
    const definitions = [
      ['editor', ['register']],
      ['reviewer', ['register']],
      ['reader', ['register']],
      ['auditor', ['log.read', 'log.export']],
      ['investigator', ['log.read']],
      ['technical', ['operations']],
    ];
    const users = definitions.map(([name, permissions]) => ({
      id: randomUUID(),
      username: `demo-${name}`,
      firstName: 'Demo',
      lastName: name,
      email: `demo-${name}@example.invalid`,
      emailVerified: true,
      enabled: true,
      credentials: [
        {
          type: 'password',
          value: randomBytes(24).toString('base64url'),
          temporary: false,
        },
      ],
      role: ['editor', 'reviewer'].includes(name) ? name : 'reader',
      permissions,
    }));
    config = {
      mode: 'local-demo',
      origin,
      tls: {
        key: await readFile(resolve(pki, 'console-server.key'), 'utf8'),
        cert: await readFile(resolve(pki, 'console-server.crt'), 'utf8'),
      },
      oidc: {
        issuer,
        clientId: 'ldv-console',
        secret: randomBytes(32).toString('hex'),
      },
      identities: Object.fromEntries(
        users.map((user) => [
          user.id,
          {
            id: user.id,
            role: user.role,
            party: scope.party,
            permissions: user.permissions,
            applications: scope.applications,
            backend: 'auditor',
          },
        ]),
      ),
      database: register.database,
      backends: {
        auditor: {
          port: 18084,
          tls,
          party: scope.party,
          applications: scope.applications,
        },
      },
    };
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
          clientId: config.oidc.clientId,
          enabled: true,
          protocol: 'openid-connect',
          publicClient: false,
          secret: config.oidc.secret,
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
      users: users.map((user) => ({
        id: user.id,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        emailVerified: user.emailVerified,
        enabled: user.enabled,
        credentials: user.credentials,
      })),
    };
    await writeFile(
      resolve(directory, 'import/realm.json'),
      JSON.stringify(realm),
      { mode: 0o600 },
    );
    await writeFile(
      resolve(directory, 'toegang.txt'),
      users.map((u) => `${u.username}: ${u.credentials[0].value}`).join('\n'),
      { mode: 0o600 },
    );
  }
  config.database = register.database;
  config.oidc.ca = ca;
  const ctx = await prepareIngest();
  try {
    const acl = (operations, scope) =>
      ctx.cli('acls', [
        '--add',
        '--allow-principal',
        'User:CN=console-ops',
        ...operations.flatMap((operation) => ['--operation', operation]),
        ...scope,
      ]);
    for (const topic of ['ldv.rejected.v1', 'ldv.dead-letter.v1'])
      acl(['Read', 'Describe'], ['--topic', topic]);
    acl(['Describe'], ['--topic', 'ldv.accepted.v1']);
    acl(['Read', 'Describe'], ['--group', 'ldv-console-ops-v1']);
    acl(['Describe'], ['--group', 'ldv-logbook-v1']);
    config.operations = {
      kafka: {
        bootstrapBrokers: ctx.kafka.bootstrapBrokers,
        tls: await ctx.tls('console-ops'),
      },
      projectorControl: query.controlToken,
    };
  } finally {
    await ctx.owner.end();
  }
  config.backends.auditor = {
    port: 18084,
    tls,
    party: scope.party,
    applications: scope.applications,
  };
  await writeFile(resolve(directory, 'config.json'), JSON.stringify(config), {
    mode: 0o600,
  });
  if (!(await ready(issuer + '/.well-known/openid-configuration', ca))) {
    command('docker', [
      'run',
      '--rm',
      '--entrypoint',
      'bash',
      '--mount',
      `type=bind,source=${resolve(directory, 'tls')},target=/source-tls,readonly`,
      '--mount',
      `type=bind,source=${resolve(directory, 'import')},target=/source-import,readonly`,
      '--volume',
      'ldv-console-idp-config:/target',
      'postgres:18.6@sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336',
      '-c',
      'install -d -m 700 -o 1000 -g 0 /target/tls /target/import; install -m 600 -o 1000 -g 0 /source-tls/identityprovider.crt /target/tls/identityprovider.crt; install -m 600 -o 1000 -g 0 /source-tls/identityprovider.key /target/tls/identityprovider.key; install -m 600 -o 1000 -g 0 /source-import/realm.json /target/import/realm.json',
    ]);
    let exists = false;
    try {
      command('docker', ['inspect', 'ldv-console-idp']);
      exists = true;
      if (
        command('docker', [
          'inspect',
          '--format',
          '{{index .Config.Labels "ldv.config-version"}}',
          'ldv-console-idp',
        ]).trim() !== '2'
      ) {
        command('docker', ['stop', 'ldv-console-idp']);
        command('docker', ['rm', 'ldv-console-idp']);
        exists = false;
      }
    } catch {
      /* Not created. */
    }
    if (exists) command('docker', ['start', 'ldv-console-idp']);
    else
      command('docker', [
        'run',
        '--detach',
        '--name',
        'ldv-console-idp',
        '--label',
        'ldv.config-version=2',
        '--restart',
        'unless-stopped',
        '--publish',
        '127.0.0.1:18086:8443',
        '--mount',
        'type=volume,source=ldv-console-idp-config,target=/local-config,readonly',
        '--mount',
        'type=volume,source=ldv-console-idp-config,target=/opt/keycloak/data/import,volume-subpath=import,readonly',
        '--volume',
        'ldv-console-idp-data:/opt/keycloak/data',
        image,
        'start',
        '--hostname=https://127.0.0.1:18086',
        '--http-enabled=false',
        '--https-certificate-file=/local-config/tls/identityprovider.crt',
        '--https-certificate-key-file=/local-config/tls/identityprovider.key',
        '--import-realm',
      ]);
    await wait(issuer + '/.well-known/openid-configuration', ca, 120000);
  }
  if (!(await ready(origin + '/ready', ca))) {
    const log = await open(resolve(directory, 'server.log'), 'a');
    const child = spawn(
      process.execPath,
      [
        resolve(root, 'apps/console/dist/server.js'),
        resolve(directory, 'config.json'),
      ],
      {
        cwd: root,
        detached: true,
        windowsHide: true,
        env: { ...process.env, NODE_EXTRA_CA_CERTS: resolve(pki, 'ca.crt') },
        stdio: ['ignore', log.fd, log.fd],
      },
    );
    child.unref();
    await log.close();
    await wait(origin + '/ready', ca, 30000);
  }
  console.log(
    `Console ready: ${origin}\nSynthetic OIDC users: ${resolve(directory, 'toegang.txt')}\nLocal CA: ${resolve(pki, 'ca.crt')}`,
  );
}
main().catch(() => {
  console.error(
    'Local console command failed; inspect the local runbook and dependency health.',
  );
  process.exitCode = 1;
});

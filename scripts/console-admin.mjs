import { readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { request } from 'node:https';
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
const root = resolve(import.meta.dirname, '..');
const directory = resolve(root, '.local/ldv-console-dev');
const password = process.argv[2];
const load = async (file) =>
  JSON.parse(await readFile(resolve(directory, file), 'utf8'));
function docker(args) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120000,
  });
  if (result.status !== 0) throw new Error('Local provider command failed');
  return result.stdout.trim();
}
async function main() {
  if (!password) throw new Error('Password argument required');
  const config = await load('config.json');
  if (
    config.mode !== 'local-demo' ||
    config.origin !== 'https://127.0.0.1:18087' ||
    config.oidc.issuer !== 'https://127.0.0.1:18086/realms/ldv'
  )
    throw new Error('Explicit local demo required');
  const ca = await readFile(resolve(root, '.local/ldv-ingest-dev/pki/ca.crt'));
  async function http(path, method = 'GET', data, token) {
    return new Promise((done, reject) => {
      const req = request(
        new URL(path, 'https://127.0.0.1:18086'),
        {
          method,
          ca,
          rejectUnauthorized: true,
          headers: {
            ...(token ? { authorization: 'Bearer ' + token } : {}),
            ...(data
              ? {
                  'content-type':
                    data instanceof URLSearchParams
                      ? 'application/x-www-form-urlencoded'
                      : 'application/json',
                }
              : {}),
          },
        },
        (res) => {
          let text = '';
          res.on('data', (part) => (text += part));
          res.on('end', () => {
            if ((res.statusCode ?? 500) >= 400)
              return reject(new Error('Provider API failed'));
            try {
              done(text ? JSON.parse(text) : {});
            } catch {
              reject(new Error('Invalid provider response'));
            }
          });
        },
      );
      req.setTimeout(5000, () => req.destroy(new Error('Provider timeout')));
      req.on('error', reject);
      req.end(
        data instanceof URLSearchParams
          ? data.toString()
          : data
            ? JSON.stringify(data)
            : undefined,
      );
    });
  }
  const client = 'ldv-provision-' + randomBytes(8).toString('hex');
  const secret = randomBytes(32).toString('hex');
  const envFile = resolve(directory, 'temporary-provision.env');
  const image = docker([
    'inspect',
    '--format',
    '{{.Config.Image}}',
    'ldv-console-idp',
  ]);
  await writeFile(envFile, 'LDV_PROVISION_SECRET=' + secret + '\n', {
    mode: 0o600,
  });
  docker(['stop', 'ldv-console-idp']);
  try {
    docker([
      'run',
      '--rm',
      '--env-file',
      envFile,
      '--volume',
      'ldv-console-idp-data:/opt/keycloak/data',
      image,
      'bootstrap-admin',
      'service',
      '--client-id',
      client,
      '--client-secret:env',
      'LDV_PROVISION_SECRET',
      '--no-prompt',
    ]);
  } finally {
    docker(['start', 'ldv-console-idp']);
    await unlink(envFile);
  }
  let ready = false;
  for (let n = 0; n < 120; n++) {
    try {
      await http('/realms/ldv/.well-known/openid-configuration');
      ready = true;
    } catch {
      /* Await provider restart. */
    }
    if (ready) break;
    await sleep(500);
  }
  if (!ready) throw new Error('Provider did not restart');
  const tokens = await http(
    '/realms/master/protocol/openid-connect/token',
    'POST',
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: client,
      client_secret: secret,
    }),
  );
  const token = tokens.access_token;
  try {
    const found = await http(
      '/admin/realms/ldv/users?username=admin&exact=true',
      'GET',
      undefined,
      token,
    );
    const existing = found.find((u) => u.username === 'admin');
    let id = existing?.id ?? randomUUID();
    if (!existing)
      await http(
        '/admin/realms/ldv/users',
        'POST',
        {
          id,
          username: 'admin',
          enabled: true,
          firstName: 'Demo',
          lastName: 'Admin',
          email: 'admin@example.invalid',
          emailVerified: true,
          credentials: [
            { type: 'password', value: password, temporary: false },
          ],
        },
        token,
      );
    else
      await http(
        '/admin/realms/ldv/users/' + id + '/reset-password',
        'PUT',
        { type: 'password', value: password, temporary: false },
        token,
      );
    const persisted = await http(
      '/admin/realms/ldv/users?username=admin&exact=true',
      'GET',
      undefined,
      token,
    );
    const providerId = persisted.find((user) => user.username === 'admin')?.id;
    if (!providerId) throw new Error('Persisted provider identity required');
    if (id !== providerId) delete config.identities[id];
    id = providerId;
    const reference = Object.values(config.identities).find(
      (a) => a.permissions.includes('register') && a.role === 'editor',
    );
    if (!reference) throw new Error('Scoped editor identity required');
    config.identities[id] = {
      ...reference,
      id,
      roles: ['editor', 'reviewer', 'reader'],
      permissions: ['register', 'log.read', 'log.export', 'operations'],
    };
    await writeFile(
      resolve(directory, 'config.json'),
      JSON.stringify(config, null, 2),
      { mode: 0o600 },
    );
    const realm = await load('import/realm.json');
    realm.users = realm.users.filter((u) => u.username !== 'admin');
    realm.users.push({
      id,
      username: 'admin',
      enabled: true,
      firstName: 'Demo',
      lastName: 'Admin',
      email: 'admin@example.invalid',
      emailVerified: true,
      credentials: [{ type: 'password', value: password, temporary: false }],
    });
    await writeFile(
      resolve(directory, 'import/realm.json'),
      JSON.stringify(realm),
      { mode: 0o600 },
    );
    const access = await readFile(resolve(directory, 'toegang.txt'), 'utf8');
    await writeFile(
      resolve(directory, 'toegang.txt'),
      access
        .split('\n')
        .filter((line) => !line.startsWith('admin:'))
        .join('\n') +
        '\nadmin: ' +
        password +
        '\n',
      { mode: 0o600 },
    );
    console.log(
      'Local console admin identity provisioned with all scoped roles; restart the console to activate.',
    );
  } finally {
    const clients = await http(
      '/admin/realms/master/clients?clientId=' + client,
      'GET',
      undefined,
      token,
    );
    for (const value of clients)
      await http(
        '/admin/realms/master/clients/' + value.id,
        'DELETE',
        undefined,
        token,
      );
  }
}
main().catch(() => {
  console.error(
    'Local admin provisioning failed; inspect provider readiness. No credentials are printed.',
  );
  process.exitCode = 1;
});

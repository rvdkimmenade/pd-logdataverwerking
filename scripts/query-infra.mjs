import { mkdir, readFile, writeFile, copyFile, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { stringify } from 'yaml';
import { command } from './process.mjs';
import { root } from './ingest-infra.mjs';
import { SearchClient } from '../apps/query/dist/search-client.js';

export async function prepareQuery(ctx, archive, test = false) {
  const directory = resolve(ctx.directory, 'query');
  const pki = resolve(ctx.directory, 'pki');
  await mkdir(resolve(directory, 'node'), { recursive: true });
  await mkdir(resolve(directory, 'security'), { recursive: true });
  command('docker', [
    'run',
    '--rm',
    ...(process.getuid
      ? ['--user', `${process.getuid()}:${process.getgid()}`]
      : []),
    '--entrypoint',
    'bash',
    '--mount',
    `type=bind,source=${pki},target=/pki`,
    '--mount',
    `type=bind,source=${resolve(root, 'scripts/query-pki.sh')},target=/generate.sh,readonly`,
    'postgres:18.6@sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336',
    '/generate.sh',
  ]);
  for (const file of ['ca.crt', 'search-node.crt', 'search-node.key']) {
    const dest = resolve(directory, 'node', file);
    await copyFile(resolve(pki, file), dest);
    await chmod(dest, file.endsWith('.key') ? 0o600 : 0o644);
  }
  const config = {
    'cluster.name': 'ldv-search',
    'node.name': 'opensearch',
    'network.host': '0.0.0.0',
    'discovery.type': 'single-node',
    'node.store.allow_mmap': false,
    'plugins.security.ssl.transport.pemcert_filepath': 'pki/search-node.crt',
    'plugins.security.ssl.transport.pemkey_filepath': 'pki/search-node.key',
    'plugins.security.ssl.transport.pemtrustedcas_filepath': 'pki/ca.crt',
    'plugins.security.ssl.http.enabled': true,
    'plugins.security.ssl.http.pemcert_filepath': 'pki/search-node.crt',
    'plugins.security.ssl.http.pemkey_filepath': 'pki/search-node.key',
    'plugins.security.ssl.http.pemtrustedcas_filepath': 'pki/ca.crt',
    'plugins.security.ssl.http.clientauth_mode': 'REQUIRE',
    'plugins.security.nodes_dn': ['CN=search-node'],
    'plugins.security.authcz.admin_dn': ['CN=search-admin'],
    'plugins.security.allow_default_init_securityindex': true,
  };
  await writeFile(resolve(directory, 'opensearch.yml'), stringify(config));
  const security = {
    config: {
      _meta: { type: 'config', config_version: 2 },
      config: {
        dynamic: {
          http: { anonymous_auth_enabled: false },
          authc: {
            clientcert: {
              http_enabled: true,
              transport_enabled: true,
              order: 0,
              http_authenticator: {
                type: 'clientcert',
                challenge: false,
                config: { username_attribute: 'cn' },
              },
              authentication_backend: { type: 'noop' },
            },
          },
        },
      },
    },
    roles: {
      _meta: { type: 'roles', config_version: 2 },
      projector: {
        cluster_permissions: ['cluster_composite_ops'],
        index_permissions: [
          { index_patterns: ['ldv-search-*'], allowed_actions: ['indices:*'] },
        ],
      },
      query: {
        cluster_permissions: [],
        index_permissions: [
          {
            index_patterns: ['ldv-search-*'],
            allowed_actions: ['indices:data/read/search*'],
          },
        ],
      },
    },
    roles_mapping: {
      _meta: { type: 'rolesmapping', config_version: 2 },
      projector: { users: ['projector'] },
      query: { users: ['query-index'] },
    },
    internal_users: { _meta: { type: 'internalusers', config_version: 2 } },
    action_groups: { _meta: { type: 'actiongroups', config_version: 2 } },
    tenants: { _meta: { type: 'tenants', config_version: 2 } },
    nodes_dn: { _meta: { type: 'nodesdn', config_version: 2 } },
    allowlist: {
      _meta: { type: 'allowlist', config_version: 2 },
      config: { enabled: false },
    },
  };
  for (const [file, value] of Object.entries(security))
    await writeFile(
      resolve(directory, 'security', `${file}.yml`),
      stringify(value),
    );
  let port = 19200;
  if (test) {
    const server = createServer();
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
    await new Promise((r) => server.close(r));
  }
  const env = {
    ...process.env,
    QUERY_DIRECTORY: directory.replaceAll('\\', '/'),
    QUERY_SEARCH_PORT: String(port),
  };
  const compose = (args, options = {}) =>
    command(
      'docker',
      [
        'compose',
        '--project-name',
        `${ctx.project}-query`,
        '--file',
        resolve(root, 'infra/compose.query.yaml'),
        ...args,
      ],
      { env, ...options },
    );
  compose(['up', '--detach'], { timeout: 180000 });
  const admin = new SearchClient({ port, tls: await ctx.tls('search-admin') });
  let ready = false;
  for (let i = 0; i < 90; i++) {
    try {
      const health = await admin.call(
        'GET',
        '/_cluster/health?wait_for_status=yellow&timeout=2s',
      );
      if (!health.timed_out && ['yellow', 'green'].includes(health.status)) {
        ready = true;
        break;
      }
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if (!ready) {
    if (test) compose(['down', '--volumes', '--remove-orphans']);
    throw new Error('Search startup timed out');
  }
  const databases = {};
  for (const [name, cert] of [
    ['logbook_projector', 'projector'],
    ['logbook_query', 'query-index'],
  ]) {
    const file = resolve(directory, `${name}-password`);
    try {
      await writeFile(file, randomBytes(32).toString('hex'), {
        flag: 'wx',
        mode: 0o600,
      });
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    const password = await readFile(file, 'utf8');
    if (!/^[a-f0-9]{64}$/.test(password))
      throw new Error('Invalid local secret');
    if (
      !(
        await ctx.owner.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [name])
      ).rowCount
    )
      await ctx.owner.query(`CREATE ROLE ${name} LOGIN PASSWORD '${password}'`);
    await ctx.owner.query(`GRANT CONNECT ON DATABASE logbook TO ${name}`);
    await archive.owner.query(
      `GRANT USAGE ON SCHEMA logbook TO ${name}; GRANT SELECT ON logbook.records TO ${name}`,
    );
    databases[cert] = {
      ...archive.reader,
      user: name,
      password,
      ssl: await ctx.tls(cert),
    };
  }
  return {
    compose,
    admin,
    directory,
    projector: {
      database: databases.projector,
      search: { port, tls: await ctx.tls('projector') },
    },
    query: {
      database: databases['query-index'],
      search: { port, tls: await ctx.tls('query-index') },
      tls: await ctx.tls('query-server'),
    },
    port,
  };
}

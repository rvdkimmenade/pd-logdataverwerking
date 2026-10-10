import { npm } from './process.mjs';
import { report } from './report.mjs';

const checks = [];
try {
  const start = Date.now();
  try {
    npm(['run', 'verify:code'], { stdio: 'inherit', timeout: 180_000 });
    checks.push({
      name: 'Formatter, lint, build, unit- en contracttests',
      passed: true,
      durationMs: Date.now() - start,
    });
  } catch (error) {
    checks.push({
      name: 'Formatter, lint, build, unit- en contracttests',
      passed: false,
      durationMs: Date.now() - start,
    });
    throw error;
  }
  const { infrastructure, recorder } = await import('./infra.mjs');
  await infrastructure('verify', recorder(checks));
  const registerStart = Date.now();
  npm(['run', 'test:register'], { stdio: 'inherit', timeout: 300_000 });
  checks.push({
    name: 'Register API, database, rollen en browser',
    passed: true,
    durationMs: Date.now() - registerStart,
  });
  const ingestStart = Date.now();
  try {
    npm(['run', 'test:ingest'], { stdio: 'inherit', timeout: 420000 });
    checks.push({
      name: 'Ingest API, mTLS, Kafka en herstel',
      passed: true,
      durationMs: Date.now() - ingestStart,
    });
  } catch (error) {
    checks.push({
      name: 'Ingest API, mTLS, Kafka en herstel',
      passed: false,
      durationMs: Date.now() - ingestStart,
    });
    throw error;
  }
} catch (error) {
  console.error(error.message);
  if (checks.every((check) => check.passed))
    checks.push({ name: 'Infrastructuurvoorbereiding', passed: false });
  process.exitCode = 1;
} finally {
  console.log(await report('foundation', checks));
}

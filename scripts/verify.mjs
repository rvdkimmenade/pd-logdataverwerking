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
} catch (error) {
  console.error(error.message);
  if (checks.every((check) => check.passed))
    checks.push({ name: 'Infrastructuurvoorbereiding', passed: false });
  process.exitCode = 1;
} finally {
  console.log(await report('foundation', checks));
}

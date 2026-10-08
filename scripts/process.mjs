import { spawnSync } from 'node:child_process';

export function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
    ...options,
  });
  if (result.error || result.status !== 0) {
    // Never include subprocess output: environment/configuration may contain secrets.
    throw new Error(
      `${executable} ${args[0] ?? ''} failed (exit ${result.status ?? 'unavailable'})`,
    );
  }
  return result.stdout ?? '';
}

export function npm(args, options = {}) {
  if (!process.env.npm_execpath)
    throw new Error('Run this command through npm run');
  return command(
    process.execPath,
    [process.env.npm_execpath, ...args],
    options,
  );
}

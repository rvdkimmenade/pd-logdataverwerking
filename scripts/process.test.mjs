import { it, expect } from 'vitest';
import { command } from './process.mjs';

it('fails on an unsuccessful subprocess without leaking its output', () => {
  expect(() =>
    command(process.execPath, [
      '-e',
      'console.error("synthetic-secret"); process.exit(7)',
    ]),
  ).toThrow('failed (exit 7)');
  try {
    command(process.execPath, [
      '-e',
      'console.error("synthetic-secret"); process.exit(7)',
    ]);
  } catch (error) {
    expect(error.message).not.toContain('synthetic-secret');
  }
});

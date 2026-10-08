import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const escape = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );

export async function report(name, checks, details = {}) {
  const directory = resolve(import.meta.dirname, '../artifacts');
  await mkdir(directory, { recursive: true });
  const result = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    ...details,
    checks,
  };
  await writeFile(
    resolve(directory, `${name}.json`),
    JSON.stringify(result, null, 2) + '\n',
  );
  const passed = checks.every((check) => check.passed);
  const rows = checks
    .map(
      (c) =>
        `<tr><td>${escape(c.name)}</td><td class="${c.passed ? 'ok' : 'fail'}">${c.passed ? 'Geslaagd' : 'Mislukt'}</td><td>${escape(c.durationMs ?? '')} ms</td></tr>`,
    )
    .join('');
  await writeFile(
    resolve(directory, `${name}.html`),
    `<!doctype html>
<html lang="nl"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>LDV — technische demo fase 0</title>
<style>body{font:17px/1.6 system-ui;margin:0;background:#f3f6fa;color:#16243a}main{max-width:900px;margin:48px auto;padding:32px;background:white;border-radius:16px}h1{line-height:1.2}small{color:#516176}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:14px 10px;border-bottom:1px solid #dce4ef}.ok{color:#087642}.fail{color:#b3261e}code{background:#edf2f7;padding:3px 6px}footer{margin-top:28px;color:#516176}</style>
<main><small>PLATFORM DIENSTVERLENING · FASE 0</small><h1>Technische basis ${passed ? 'geverifieerd' : 'nog niet gereed'}</h1>
<p>Werkelijke controles van de ontwikkelomgeving. PostgreSQL beantwoordt een query; Kafka ontvangt en levert een synthetisch testbericht.</p>
<p>Dit is een rapport van een uitgevoerde test, geen live monitor of register-/logboekapplicatie. De functionele componenten volgen in latere fasen.</p>
<table><thead><tr><th>Controle</th><th>Resultaat</th><th>Duur</th></tr></thead><tbody>${rows}</tbody></table>
<footer>Uitgevoerd: ${escape(result.generatedAt)} · Node ${escape(result.node)}<br>Opnieuw uitvoeren: <code>npm run ${name === 'demo' ? 'demo' : 'verify'}</code><br>Geen persoonsgegevens of secrets in dit rapport.</footer></main></html>`,
  );
  return resolve(directory, `${name}.html`);
}

#!/usr/bin/env node
/**
 * Render kb page view from causes.ts logic + reports-4471.json (S01E03).
 * Output: desk/4471-filed-separately.html (static runbook-style view).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'src/lib/data');
const tenantsDir = path.join(dataDir, 'tenants');

const reports = JSON.parse(fs.readFileSync(path.join(dataDir, 'reports-4471.json'), 'utf8'));
const pageSrc = fs.readFileSync(
  path.join(root, 'src/routes/kb/incidents/4471-filed-separately/+page.svx'),
  'utf8',
);
const front = (key) => pageSrc.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim();
const signature = front('signature');
const status = front('status') ?? 'filed';

const DATE_HINT = { 'booking-v2': 'DD/MM/YYYY', 'booking-v3': 'MM/DD/YYYY' };

function dayFirst(locale) {
  const order = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(new Date(Date.UTC(2026, 0, 2, 12)))
    .map((p) => p.type);
  return order.indexOf('day') < order.indexOf('month');
}

function tenantOf(r) {
  return JSON.parse(fs.readFileSync(path.join(tenantsDir, `${r.tenant}.json`), 'utf8'));
}

function causeOf(r, t) {
  if (!t || !dayFirst(t.locale)) return null;
  return r.channel === 'form' && DATE_HINT[t.form].startsWith('MM') ? 'hint' : 'parser';
}

const merged = [...new Map(reports.map((r) => [r.id, r])).values()].filter((r) => r.mergedInto === 4471);
const byCause = new Map();
for (const r of merged) {
  const c = causeOf(r, tenantOf(r)) ?? 'unplaced';
  if (!byCause.has(c)) byCause.set(c, []);
  byCause.get(c).push(r);
}

const groups = [...byCause.entries()]
  .map(([cause, rs]) => ({
    cause,
    n: rs.length,
    tenants: new Set(rs.map((r) => r.tenant)).size,
  }))
  .sort((a, b) => b.n - a.n);

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function fnv1a(text, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}
function deskRef(sig) {
  const t = sig.trim();
  const a = fnv1a(t, 0x811c9dc5);
  const b = fnv1a(t, 0x9e3779b9);
  let bits = (BigInt(a) << 8n) | BigInt(b & 0xff);
  let out = '';
  for (let i = 0; i < 8; i++) {
    out = ALPHABET[Number(bits & 31n)] + out;
    bits >>= 5n;
  }
  return `DR-${out.slice(0, 4)}-${out.slice(4)}`;
}

const ref = signature ? deskRef(signature) : 'DR-????-????';
const closed = status === 'closed';
const TICKET = {
  parser: { issue: 1, outcome: 'fixed · closed completed' },
  hint: { issue: 2, outcome: "won't fix · closed not planned" },
};
const issueUrl = (n) => `https://github.com/dawidLubcz/s01e03-what-it-shows-v2/issues/${n}`;
const rows = groups
  .map((g) => {
    const t = TICKET[g.cause];
    const cell = t ? `<a href="${issueUrl(t.issue)}">#${t.issue}</a>${closed ? ` · ${t.outcome}` : ' · open'}` : '';
    return `<tr><td><code>${g.cause}</code></td><td>${g.n}</td><td>${g.tenants}</td><td>${cell}</td></tr>`;
  })
  .join('\n');
const deskUpdate = closed
  ? `<p>Desk update: #4471 closed 5 Oct — <code>parser</code> fixed by <code>fix(dates): parse dd/mm for eu locales</code>, <code>hint</code> won't fix (booking-v3 form retired).</p>`
  : '';

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>#4471 · two causes filed separately · support kb</title>
  <style>
    :root { --bg:#fbfaf7; --fg:#1d1d1b; --muted:#6b6a66; --line:#e3e0d8; --accent:#2f6f5e; }
    body { font: 16px/1.5 system-ui, sans-serif; background: var(--bg); color: var(--fg); max-width: 52rem; margin: 2rem auto; padding: 0 1rem; }
    h1 { font-size: 1.6rem; }
    .meta { color: var(--muted); font-size: 0.9rem; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
    th, td { border-bottom: 1px solid var(--line); padding: 0.4rem 0.5rem; text-align: left; }
    .stamp { margin-top: 2rem; font: 0.85rem ui-monospace, monospace; color: var(--muted); }
    .stamp b { color: var(--accent); }
  </style>
</head>
<body>
  <p class="meta">support desk · kb</p>
  <h1>#4471 · two causes filed separately</h1>
  <p class="meta">owner <b>dawidLubcz</b> · status <b>${status}</b> · reviewed 2026-11-06</p>
  <p><strong>${merged.length}</strong> reports merged into #4471 · <strong>${groups.length}</strong> causes (computed from <code>causes.ts</code> + export data).</p>
  ${deskUpdate}
  <table>
    <thead><tr><th>cause</th><th>reports</th><th>tenants</th><th>filed</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
  <p class="stamp">desk ref <b>${ref}</b></p>
</body>
</html>
`;

const outDir = path.join(root, 'desk');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, '4471-filed-separately.html');
fs.writeFileSync(outFile, html);
console.log('Wrote', outFile, 'desk ref', ref);

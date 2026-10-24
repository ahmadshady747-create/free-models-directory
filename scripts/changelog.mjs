// Changelog helper (Fix 3). Used by Muse's daily flow, never by the owner.
// Usage:
//   node scripts/changelog.mjs no-change [YYYY-MM-DD]
// Merges a no-change day into the last entry when it is already a
// no-change run (updates date_end + consecutive_days); otherwise appends
// one new no-change entry. Never invents a provider change.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addNoChange, getLastUpdated } from '../src/lib/changelog.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'src/data/changelog.json');

const [command, dateArg] = process.argv.slice(2);
if (command !== 'no-change') {
  console.log('Usage: node scripts/changelog.mjs no-change [YYYY-MM-DD]');
  process.exit(1);
}
const dateStr = dateArg || new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
  console.error('Date must be YYYY-MM-DD');
  process.exit(1);
}
const entries = JSON.parse(readFileSync(file, 'utf8'));
const updated = addNoChange(entries, dateStr);
writeFileSync(file, JSON.stringify(updated, null, 2) + '\n', 'utf8');
console.log(`changelog updated: last updated = ${getLastUpdated(updated)}, entries = ${updated.length}`);

// Deterministic daily model-list maintenance for the free-models directory.
// Run daily by .github/workflows/daily-update.yml (and by the daily Muse
// cron, which does the verified part of the model update separately).
//
// WHAT IT DOES — and only this:
//   1. Expires temporary offers whose recorded offer_expires_at date has
//      passed: offer_temporary true -> false. The entry itself is NEVER
//      deleted, offer_expires_at is kept as the historical record, and a
//      changelog entry of type "انتهاء عرض" records the change, exactly as
//      the health check requires ("never delete it silently").
//   2. Nothing else.
//
// WHAT IT NEVER DOES:
//   - Never touches free_limit, free_type, status, last_checked, models,
//     verification_source, or any other field. A changed content hash or a
//     new limit on a provider page cannot be inferred by a script: limits
//     are updated only after a human/agent verifies the official source
//     (see the daily Muse cron and the health-check issue flow).
//   - Never adds or removes entries. New free offers are added only with
//     official proof, by the daily agent run.
//   - Never touches news.json, content-hashes.json, or the sitemap.
//     Expiring an offer changes no page count, so the sitemap is unaffected.
//
// Exit code is always 0: a no-op day (no expired offers — the common case,
// since all current temporary offers have unknown expiry) is a success.
// Use --dry-run to report what would change without writing anything.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APIS_PATH = path.join(root, 'src/data/apis.json');
const CHANGELOG_PATH = path.join(root, 'src/data/changelog.json');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

export function main({ dryRun = false, today = todayUtc() } = {}) {
  const apis = JSON.parse(readFileSync(APIS_PATH, 'utf8'));
  const changelog = JSON.parse(readFileSync(CHANGELOG_PATH, 'utf8'));

  const expired = apis.filter(
    (a) => a.offer_temporary === true && typeof a.offer_expires_at === 'string' && DATE_RE.test(a.offer_expires_at) && a.offer_expires_at < today,
  );

  console.log(`temporary offers: ${apis.filter((a) => a.offer_temporary).length} (dated: ${apis.filter((a) => a.offer_expires_at).length})`);
  if (expired.length === 0) {
    console.log('no temporary offers expired — apis.json and changelog.json unchanged.');
    return { expired: [], changed: false };
  }

  for (const entry of expired) {
    console.log(`expiring: ${entry.id} (${entry.provider}) — offer ended ${entry.offer_expires_at}`);
    if (!dryRun) {
      entry.offer_temporary = false;
      changelog.push({
        date: today,
        model: entry.name,
        new_limit: `انتهى العرض المؤقت بتاريخ ${entry.offer_expires_at}؛ العرض لم يعد مؤقتا ساريا، والإدخال باقٍ في الدليل بحدّه العادي.`,
        old_limit: `عرض مؤقت سارٍ حتى ${entry.offer_expires_at}: ${entry.free_limit}`,
        provider: entry.provider,
        source: 'تاريخ الانتهاء المسجل في apis.json (offer_expires_at) — تغيير حتمي من التاريخ نفسه، لا من إعادة فحص الصفحة.',
        type: 'انتهاء عرض',
      });
    }
  }

  if (!dryRun) {
    writeFileSync(APIS_PATH, JSON.stringify(apis, null, 2) + '\n', 'utf8');
    writeFileSync(CHANGELOG_PATH, JSON.stringify(changelog, null, 2) + '\n', 'utf8');
    console.log(`wrote ${expired.length} expired offer(s) to apis.json + changelog.json`);
  } else {
    console.log(`dry run — would expire ${expired.length} offer(s), nothing written.`);
  }
  return { expired: expired.map((e) => e.id), changed: !dryRun };
}

// Run only when executed directly.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    main({ dryRun: process.argv.includes('--dry-run') });
  } catch (e) {
    console.error(`update-models-daily failed unexpectedly: ${e.message}`);
    process.exit(0); // never fail the daily workflow on this script alone
  }
}

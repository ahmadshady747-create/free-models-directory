// Builds the daily health-issue body for .github/workflows/daily-update.yml
// from health-report.json (written by the network health check) and
// verify-report.json (written by scripts/verify-models-gemini.mjs when the
// GEMINI_API_KEY secret is set). Also sets the workflow outputs
// has_findings and issue_title in $GITHUB_OUTPUT.
//
// The issue cross-references each flagged page with what Gemini already
// did with it, so a human never re-checks work the automation finished:
//   ✅ applied   — limit updated from the official page (with quote)
//   ✅ verified  — re-checked, recorded value stands
//   ⚠️ review    — Gemini reported "no free offer"; a human must decide
//   ⏭️ skipped   — fetch/model failure; needs a manual check
// Pages Gemini never saw (no key, or not flagged) are listed plainly.

import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';

const today = new Date().toISOString().slice(0, 10);
const health = JSON.parse(readFileSync('health-report.json', 'utf8'));
const verify = existsSync('verify-report.json') ? JSON.parse(readFileSync('verify-report.json', 'utf8')) : null;

const changed = health.entries.filter((e) => e.content_hash_changed);
const needs = health.entries.filter((e) => e.needs_agent_search);
const has = changed.length > 0 || needs.length > 0;

const output = process.env.GITHUB_OUTPUT;
if (output) {
  appendFileSync(output, `has_findings=${has}\n`);
  appendFileSync(output, `issue_title=فحص يومي ${today}: صفحات تغيّرت أو تحتاج مراجعة\n`);
}

if (!has) {
  console.log('no health findings — no issue needed.');
  process.exit(0);
}

const byId = new Map();
for (const a of verify?.applied || []) byId.set(a.id, { kind: 'applied', ...a });
for (const u of verify?.unchanged || []) byId.set(u.id, { kind: 'verified', ...u });
for (const n of verify?.needs_review || []) byId.set(n.id, { kind: 'review', ...n });
for (const s of verify?.skipped || []) byId.set(s.id, { kind: 'skipped', ...s });

const outcome = (e) => {
  const v = byId.get(e.id);
  if (!v) return '';
  if (v.kind === 'applied') return ` — ✅ طُبّق: ${v.new_free_limit}`;
  if (v.kind === 'verified') return ` — ✅ أعيد التحقق: ${v.reason}`;
  if (v.kind === 'review') return ` — ⚠️ يحتاج قرارا بشريا: ${v.verdict} (الخطط الظاهرة: ${v.plans_seen || 'غير مذكورة'})`;
  return ` — ⏭️ تخطّى: ${v.reason}`;
};

let body = `# فحص يومي ${today}\n\nهذا البلاغ آلي من فحص الصحة اليومي. تغيّر بصمة المحتوى لا يعني تغيّر الحد المجاني بالضرورة — تحقّق من المصدر الرسمي لكل إدخال قبل تعديل apis.json أو changelog.json أو content-hashes.json.\n`;
if (verify) body += `\nتحقق Gemini الآلي من ${verify.candidates.length} إدخالا: طبّق ${verify.applied.length}، وأعاد التحقق من ${verify.unchanged.length} بلا تغيير، وترك ${verify.needs_review.length} لقرار بشري، وتخطّى ${verify.skipped.length}.\n`;

if (changed.length > 0) {
  body += `\n## صفحات تغيّر محتواها (${changed.length})\n`;
  for (const e of changed) body += `- \`${e.id}\` (${e.provider}) — ${e.checked_url}${outcome(e)}\n`;
}
if (needs.length > 0) {
  body += `\n## صفحات تحتاج مراجعة يدوية (${needs.length})\n`;
  for (const e of needs) body += `- \`${e.id}\` (${e.provider}) — ${e.checked_url} — ${e.needs_agent_search_reason || ''}${outcome(e)}\n`;
}
if (verify?.applied?.length > 0) {
  body += `\n## ما طبّقه Gemini اليوم (${verify.applied.length})\n`;
  for (const a of verify.applied) {
    body += `- \`${a.id}\`: ${a.old_free_limit} ← ${a.new_free_limit} — المصدر: ${a.source_url} — الاقتباس: «${(a.quote || '').slice(0, 200)}»\n`;
  }
}
if (verify?.needs_review?.length > 0) {
  body += `\n## ما يحتاج قرارا بشريا (${verify.needs_review.length})\n`;
  body += `هذه الإدخالات لم يُطبَّق عليها شيء تلقائيا. إن تأكد انتهاء العرض المجاني من الصفحة الرسمية، حدّث apis.json وchangelog.json يدويا (الإدخال يبقى بملاحظة صادقة ولا يُحذف بصمت).\n`;
  for (const n of verify.needs_review) {
    body += `- \`${n.id}\`: ${n.verdict} — الخطط الظاهرة: ${n.plans_seen || 'غير مذكورة'} — المصدر: ${n.source_url}\n`;
  }
}

writeFileSync('health-issue-body.md', body);
console.log(`findings: ${changed.length} changed, ${needs.length} need review.`);

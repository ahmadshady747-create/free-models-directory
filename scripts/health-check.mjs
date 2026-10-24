// Health-check script for the AI-model API directory (Fix 2).
// Run by Muse (daily at launch, via a cron set up by the main agent).
// The site owner is NEVER required to run this or enter data daily.
//
// Modes:
//   node scripts/health-check.mjs
//     Default: schema + staleness + key-scan + sitemap coverage, NO network.
//     Still writes health-report.json with per-entry fields marked not_checked.
//   node scripts/health-check.mjs --network
//     Level 1: for each entry, fetch its pricing page (and docs page when the
//     pricing fetch is inconclusive), compute a SHA-256 content hash of the
//     visible text, and compare it with src/data/content-hashes.json.
//     A changed hash is reported as content_changed — it is NEVER auto-applied
//     to apis.json. Muse must verify the change against the official source
//     first, and only then update apis.json, changelog.json, and the hash file.
//   node scripts/health-check.mjs --network --update-hashes
//     Same as --network, then writes the freshly fetched hashes into
//     src/data/content-hashes.json. Use ONLY after Muse has verified each
//     changed page from its official source. Never use it to silently accept
//     a change.
//   Level 2 fallback: a blocked fetch (403/429/timeout), an empty/JS-only
//   page, or a network error is recorded as needs_agent_search for that
//   provider, with the URL and reason — never as a silent failure and never
//   as a false "down" verdict. Muse must then use web search to check the
//   official pricing/limits/announcements for that provider directly.
//
// Output: health-report.json in the project root (gitignored, temp only —
// it is NOT site data and must not be published as a page). A human-readable
// console summary is printed too. The run only fails on schema/sitemap/key
// problems; a blocked page or a changed hash is a warning for Muse, not a
// build failure, because providers routinely block bots.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getLastUpdated } from '../src/lib/changelog.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const network = process.argv.includes('--network');
const updateHashes = process.argv.includes('--update-hashes');
const load = (p) => JSON.parse(readFileSync(path.join(root, p), 'utf8'));
const loadIfExists = (p, fallback) =>
  existsSync(path.join(root, p)) ? load(p) : fallback;

const apis = load('src/data/apis.json');
const categories = load('src/data/categories.json').categories;
const changelog = load('src/data/changelog.json');
const sitemap = readFileSync(path.join(root, 'public/sitemap.xml'), 'utf8');
const hashState = loadIfExists('src/data/content-hashes.json', {});

const required = ['id', 'name', 'provider', 'category', 'description_ar', 'models', 'free_type', 'free_limit', 'auth', 'card_required', 'cors', 'status', 'last_checked', 'website', 'docs', 'pricing', 'example_curl', 'example_fetch', 'offer_temporary', 'playgrounds'];
const playgroundFormats = {
  chat: ['openai-chat', 'pollinations-chat', 'anthropic-messages', 'gemini-generate'],
  image: ['openai-image', 'pollinations-image', 'ideogram-image', 'stability-image'],
  video: ['runway-task', 'luma-generation', 'minimax-video'],
  prediction: ['replicate-prediction'],
  audio: ['elevenlabs-tts', 'deepgram-speak'],
  transcribe: ['deepgram-listen'],
  embeddings: ['cohere-embed', 'voyage-embed', 'jina-embed'],
  vision: ['clarifai-vision', 'roboflow-detect', 'google-vision'],
  translate: ['deepl-translate', 'google-translate', 'ms-translator', 'libre-translate'],
};
const playgroundStatuses = ['implemented', 'browser-blocked', 'not-suitable', 'needs-confirmation'];
const problems = [];
const warnings = [];
const catIds = new Set(categories.map((c) => c.id));
const counts = {};

for (const api of apis) {
  counts[api.category] = (counts[api.category] || 0) + 1;
  if (!catIds.has(api.category)) problems.push(`${api.id}: unknown category ${api.category}`);
  for (const f of required) {
    // playgrounds may legitimately be [] (format undocumented) — the detail
    // page handles that case honestly. It must be present and an array,
    // but an empty array is NOT a missing field. Every other array field
    // here (models) must be non-empty.
    const isEmptyArray = Array.isArray(api[f]) && api[f].length === 0;
    if (api[f] === undefined || api[f] === '' || (isEmptyArray && f !== 'playgrounds')) {
      problems.push(`${api.id}: missing field ${f}`);
    }
  }
  for (const u of ['website', 'docs', 'pricing']) {
    if (api[u] && !api[u].startsWith('https://')) warnings.push(`${api.id}: ${u} is not https: ${api[u]}`);
  }
  if (api.free_limit !== 'غير مؤكد' && api.last_price_checked === 'غير مؤكد') {
    warnings.push(`${api.id}: has a stated limit but no price-check date`);
  }
  if (api.last_price_checked !== 'غير مؤكد' && !/^\d{4}-\d{2}-\d{2}$/.test(api.last_price_checked)) {
    warnings.push(`${api.id}: last_price_checked is not a date: ${api.last_price_checked}`);
  }
  if (!sitemap.includes(`/apis/${api.id}/`)) problems.push(`${api.id}: missing from sitemap.xml`);
  if (api.status === 'موثق جزئيا' && !api.verification_source?.startsWith('https://')) problems.push(`${api.id}: partially verified but no https verification_source`);
  if (api.status !== 'قيد التحقق' && api.status !== 'موثق جزئيا' && api.status !== 'موثق') problems.push(`${api.id}: unknown verification status ${api.status}`);
  if (api.live_try && !api.live_try.endpoint?.startsWith('https://')) problems.push(`${api.id}: live_try endpoint is not https`);
  if (typeof api.offer_temporary !== 'boolean') problems.push(`${api.id}: offer_temporary must be boolean`);
  if (api.offer_expires_at !== null && !/^\d{4}-\d{2}-\d{2}$/.test(api.offer_expires_at || '')) problems.push(`${api.id}: offer_expires_at must be null or an ISO date`);
  if (!Array.isArray(api.playgrounds)) problems.push(`${api.id}: playgrounds must be an array`);
  if (!playgroundStatuses.includes(api.playground_status)) problems.push(`${api.id}: unknown playground_status ${api.playground_status}`);
  if (api.playground_status === 'implemented' && api.playgrounds.length === 0) problems.push(`${api.id}: playground_status implemented but no playgrounds`);
  if (api.playground_status !== 'implemented' && api.playgrounds.length > 0) problems.push(`${api.id}: playground_status ${api.playground_status} but playgrounds present`);
  if (api.playground_status !== 'implemented' && !api.playground_block_reason) problems.push(`${api.id}: non-implemented playground without a reason`);
  for (const pg of api.playgrounds || []) {
    if (!playgroundFormats[pg.kind]?.includes(pg.format)) problems.push(`${api.id}: undocumented playground format ${pg.kind}/${pg.format}`);
    if (!pg.endpoint?.startsWith('https://')) problems.push(`${api.id}: playground endpoint is not https`);
    if (pg.poll_endpoint && !pg.poll_endpoint.startsWith('https://')) problems.push(`${api.id}: playground poll endpoint is not https`);
    if (pg.poll_endpoint && (!pg.poll_interval_ms || !pg.max_poll_ms)) problems.push(`${api.id}: async playground without poll interval/timeout`);
    if (pg.kind === 'video' && pg.poll_interval_ms && pg.poll_interval_ms < 5000) problems.push(`${api.id}: video poll interval below 5 seconds`);
  }
  if (api.offer_expires_at && new Date(api.offer_expires_at) < new Date(new Date().toISOString().slice(0, 10))) warnings.push(`${api.id}: temporary offer expired on ${api.offer_expires_at} — Muse must add a changelog entry, never delete it silently`);
}

// Key scan: no real-looking keys anywhere in src/ (YOUR_KEY placeholders are allowed).
import { readdirSync, statSync } from 'node:fs';
const keyPattern = /(sk-[A-Za-z0-9]{10,}|hf_[A-Za-z0-9]{10,}|xox[baprs]-[A-Za-z0-9-]{10,})/;
function scan(dir) {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) scan(p);
    else if (/\.(astro|json|js|mjs|md)$/.test(entry)) {
      const text = readFileSync(p, 'utf8');
      if (keyPattern.test(text)) problems.push(`possible real key pattern in ${p}`);
    }
  }
}
scan(path.join(root, 'src'));

if (!existsSync(path.join(root, 'public/_headers')) || !readFileSync(path.join(root, 'public/_headers'), 'utf8').includes('X-Content-Type-Options: nosniff')) warnings.push('public/_headers missing or lacks X-Content-Type-Options (only active on Cloudflare Pages deploy)');
if (!sitemap.includes('/privacy/')) warnings.push('sitemap.xml missing /privacy/');

const lastUpdated = getLastUpdated(changelog);
const today = new Date().toISOString().slice(0, 10);
const staleDays = lastUpdated
  ? Math.floor((new Date(today) - new Date(lastUpdated)) / 86400000)
  : null;
if (staleDays !== null && staleDays > 1) warnings.push(`changelog last updated ${lastUpdated} (${staleDays} days ago) — daily update is overdue`);

// ---- Level 1/2 network checking (only with --network) ----
function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'ai-api-directory-health-check/0.1 (+local, no scraping of paywalled content)' },
    });
    if (res.status === 403 || res.status === 429) {
      return { blocked: true, reason: `HTTP ${res.status} — provider blocks automated fetches` };
    }
    if (!res.ok) return { blocked: false, reason: `HTTP ${res.status}`, httpStatus: res.status };
    const html = await res.text();
    const text = visibleText(html).slice(0, 200000);
    if (text.length < 200) {
      return { blocked: true, reason: 'page returned almost no visible text — likely JS-dependent' };
    }
    return { blocked: false, text, httpStatus: res.status };
  } catch (e) {
    return { blocked: true, reason: `fetch failed: ${e.name === 'AbortError' ? 'timeout' : String(e.message || e)}` };
  } finally {
    clearTimeout(timer);
  }
}

async function checkWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

const entriesReport = [];
const newHashState = { ...hashState };

if (network) {
  const fetched = await checkWithConcurrency(apis, 6, async (api) => {
    // Pricing first; docs only if pricing is blocked/inconclusive.
    let result = await fetchText(api.pricing);
    let checkedUrl = api.pricing;
    if (result.blocked && !result.httpStatus) {
      const docsResult = await fetchText(api.docs);
      if (!docsResult.blocked) { result = docsResult; checkedUrl = api.docs; }
    }
    return { api, result, checkedUrl };
  });
  for (const { api, result, checkedUrl } of fetched) {
    let linkStatus;
    let hashStatus;
    let needsAgentSearch = false;
    let reason = null;
    if (result.blocked) {
      linkStatus = 'blocked';
      hashStatus = 'not_checked';
      needsAgentSearch = true;
      reason = result.reason;
    } else if (result.text === undefined) {
      // Non-2xx but not a bot block: record the status honestly.
      linkStatus = `http_${result.httpStatus}`;
      hashStatus = 'not_checked';
      reason = result.reason || null;
    } else {
      linkStatus = 'ok';
      const hash = createHash('sha256').update(result.text, 'utf8').digest('hex');
      const previous = hashState[api.id];
      if (!previous) hashStatus = 'no_baseline';
      else if (previous === hash) hashStatus = 'unchanged';
      else hashStatus = 'content_changed';
      if (hashStatus === 'content_changed') {
        warnings.push(`${api.id}: pricing/docs content changed since last hash — verify from official source before updating apis.json`);
      }
      if (updateHashes) newHashState[api.id] = hash;
    }
    entriesReport.push({
      id: api.id,
      provider: api.provider,
      checked_url: checkedUrl,
      website: api.website,
      docs: api.docs,
      pricing: api.pricing,
      link_status: linkStatus,
      content_hash_status: hashStatus,
      content_hash_changed: hashStatus === 'content_changed',
      needs_agent_search: needsAgentSearch,
      needs_agent_search_reason: needsAgentSearch ? reason : null,
    });
  }
  if (updateHashes) {
    writeFileSync(path.join(root, 'src/data/content-hashes.json'), JSON.stringify(newHashState, null, 2) + '\n', 'utf8');
  }
} else {
  for (const api of apis) {
    entriesReport.push({
      id: api.id,
      provider: api.provider,
      checked_url: null,
      website: api.website,
      docs: api.docs,
      pricing: api.pricing,
      link_status: 'not_checked',
      content_hash_status: 'not_checked',
      content_hash_changed: false,
      needs_agent_search: false,
      needs_agent_search_reason: 'network check not run; re-run with --network for link and content-hash checking',
    });
  }
}

const report = {
  generated_at: new Date().toISOString(),
  mode: network ? (updateHashes ? 'network+update-hashes' : 'network') : 'offline',
  entries: entriesReport,
  summary: {
    total: apis.length,
    problems: problems.length,
    warnings: warnings.length,
    link_ok: entriesReport.filter((e) => e.link_status === 'ok').length,
    link_blocked: entriesReport.filter((e) => e.link_status === 'blocked').length,
    content_changed: entriesReport.filter((e) => e.content_hash_changed).length,
    content_unchanged: entriesReport.filter((e) => e.content_hash_status === 'unchanged').length,
    no_baseline: entriesReport.filter((e) => e.content_hash_status === 'no_baseline').length,
    needs_agent_search: entriesReport.filter((e) => e.needs_agent_search).length,
    needs_agent_search_ids: entriesReport.filter((e) => e.needs_agent_search).map((e) => e.id),
    last_changelog_update: lastUpdated,
  },
};
writeFileSync(path.join(root, 'health-report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');

console.log('--- AI API directory health check ---');
console.log(`entries: ${apis.length}`);
console.log(`per category: ${JSON.stringify(counts)}`);
console.log(`statuses: ${JSON.stringify(apis.reduce((a, x) => { a[x.status] = (a[x.status] || 0) + 1; return a; }, {}))}`);
console.log(`unverified (قيد التحقق): ${apis.filter((a) => a.status === 'قيد التحقق').length}`);
console.log(`temporary offers: ${apis.filter((a) => a.offer_temporary).length} (dated: ${apis.filter((a) => a.offer_expires_at).length}, unknown expiry: ${apis.filter((a) => a.offer_temporary && !a.offer_expires_at).length})`);
console.log(`with playground: ${apis.filter((a) => a.playgrounds?.length).length} (chat/image/audio kinds: ${JSON.stringify(apis.flatMap((a) => a.playgrounds || []).reduce((acc, p) => { acc[p.kind] = (acc[p.kind] || 0) + 1; return acc; }, {}))})`);
console.log(`last changelog update: ${lastUpdated}`);
console.log(`network mode: ${network ? 'on' : 'off'} — report: health-report.json (summary: link_ok=${report.summary.link_ok}, blocked=${report.summary.link_blocked}, content_changed=${report.summary.content_changed}, needs_agent_search=${report.summary.needs_agent_search})`);
console.log(`problems: ${problems.length}`);
problems.forEach((p) => console.log(`  PROBLEM: ${p}`));
console.log(`warnings: ${warnings.length}`);
warnings.forEach((w) => console.log(`  WARNING: ${w}`));
if (report.summary.needs_agent_search_ids.length) {
  console.log('needs_agent_search (Muse must verify these by web search from official sources):');
  for (const e of entriesReport.filter((x) => x.needs_agent_search)) {
    console.log(`  ${e.id}: ${e.checked_url} — ${e.needs_agent_search_reason}`);
  }
}

if (problems.length > 0) {
  console.log('RESULT: FAIL — fix the problems above before rebuilding.');
  process.exit(1);
}
console.log('RESULT: OK — schema, sitemap and key scan pass. Muse should still review warnings, content_changed entries, and needs_agent_search entries before updating the changelog.');

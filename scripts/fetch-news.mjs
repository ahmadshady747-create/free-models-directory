// Fetch AI news from public RSS feeds into src/data/news.json.
// Run daily by .github/workflows/daily-update.yml (and manually any time).
//
// Rules:
//   - No new dependencies: node fetch + a small targeted RSS parser.
//   - Per-feed try/catch: one failed feed never fails the script.
//   - If ALL feeds fail (or yield zero items), exit 0 and keep the
//     previous news.json untouched — never wipe the news.
//   - Only news.json is written. apis.json, changelog.json and
//     content-hashes.json are never touched by this script.

import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NEWS_PATH = path.join(root, 'src/data/news.json');
const MAX_ITEMS = 12;
// Per-feed cap applied BEFORE merging: Google News publishes far more
// often than the other two feeds, so a plain newest-first merge would
// fill all 12 slots with Google News alone and the other sources would
// never appear. Six per feed keeps the mix while staying recent.
const MAX_PER_FEED = 6;
const FETCH_TIMEOUT_MS = 8000;

// Verified live (HTTP 200 with items) 2026-11-15. The Verge AI feed
// returned 404 — do NOT add it back without re-verifying.
const FEEDS = [
  {
    name: 'أخبار Google',
    url: 'https://news.google.com/rss/search?q=%D8%A7%D9%84%D8%B0%D9%83%D8%A7%D8%A1%20%D8%A7%D9%84%D8%A7%D8%B5%D8%B7%D9%86%D8%A7%D8%B9%D9%8A&hl=ar&gl=EG&ceid=EG:ar',
  },
  {
    name: 'MIT Technology Review',
    url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed/',
  },
  {
    name: 'Hugging Face',
    url: 'https://huggingface.co/blog/feed.xml',
  },
];

// Strip CDATA wrappers, remove any HTML tags, decode common entities.
// Numeric entities (&#8211; etc.) are decoded first, &amp; last, so a
// literal "&amp;#8211;" in the source is not double-decoded.
export function cleanText(raw) {
  if (!raw) return '';
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_m, n) => {
      const cp = Number(n);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => {
      const cp = parseInt(h, 16);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    })
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTag(itemXml, tag) {
  const m = itemXml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1].trim() : '';
}

// Minimal RSS 2.0 <item> parser: title, link, pubDate (dc:date fallback).
export function parseFeed(xml, sourceName) {
  const items = [];
  const blocks = xml.split(/<item[\s>]/i).slice(1);
  for (const block of blocks) {
    const itemXml = block.split(/<\/item>/i)[0];
    const title = cleanText(extractTag(itemXml, 'title'));
    const link = cleanText(extractTag(itemXml, 'link'));
    const dateRaw = extractTag(itemXml, 'pubDate') || extractTag(itemXml, 'dc:date');
    const parsed = dateRaw ? new Date(dateRaw) : null;
    if (!title || !link || !parsed || Number.isNaN(parsed.getTime())) continue;
    items.push({
      title,
      link,
      source: sourceName,
      published_at: parsed.toISOString(),
    });
  }
  return items;
}

async function fetchFeed(feed) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(feed.url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'free-models-directory-news-fetch/0.1 (+rss, no scraping)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    return parseFeed(xml, feed.name);
  } finally {
    clearTimeout(timer);
  }
}

export async function main() {
  const all = [];
  const perFeed = [];
  for (const feed of FEEDS) {
    try {
      const items = await fetchFeed(feed);
      perFeed.push(`${feed.name}: ${items.length}`);
      items.sort((a, b) => (a.published_at < b.published_at ? 1 : -1));
      all.push(...items.slice(0, MAX_PER_FEED));
    } catch (e) {
      perFeed.push(`${feed.name}: FAILED (${e.name === 'AbortError' ? 'timeout' : e.message})`);
    }
  }
  console.log(`feeds — ${perFeed.join(' · ')}`);

  if (all.length === 0) {
    console.log('no news items fetched from any feed — keeping previous news.json untouched.');
    return 0;
  }

  const seen = new Set();
  const deduped = all.filter((item) => {
    if (seen.has(item.link)) return false;
    seen.add(item.link);
    return true;
  });
  deduped.sort((a, b) => (a.published_at < b.published_at ? 1 : -1));
  const items = deduped.slice(0, MAX_ITEMS);

  const out = { updated_at: new Date().toISOString(), items };
  writeFileSync(NEWS_PATH, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`wrote ${items.length} news items to src/data/news.json`);
  return 0;
}

// Run only when executed directly (importing this module for testing
// the parser does not fetch or write anything).
const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(`fetch-news failed unexpectedly: ${e.message}`);
      process.exit(0); // never fail the daily workflow on news alone
    },
  );
}

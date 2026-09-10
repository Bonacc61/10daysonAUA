/**
 * Pushes the built sitemap's URLs to IndexNow so Bing, Yandex, Seznam and
 * Naver fetch them within hours instead of waiting for their next crawl.
 * Bing's index feeds ChatGPT search, so this is the GEO half of the SEO
 * strategy — but note what it is NOT: Google does not participate in
 * IndexNow, so this script cannot speed up Google indexing at all.
 *
 * Reads URLs from the BUILT dist/sitemap.xml, not from source, so it submits
 * exactly what is actually live. Run `npm run build` first.
 *
 * A plain .cjs, not a bundled .ts like tools/run-drift.cjs: those wrap a
 * TypeScript file that calls the app's real loadCatalog() and needs
 * import.meta.env baked in at bundle time. This script only reads a static
 * XML file and does an HTTP POST — no app code, no TypeScript needed.
 *
 * Usage:
 *   node tools/run-indexnow.cjs --dry-run   # print what would be submitted; sends nothing
 *   node tools/run-indexnow.cjs             # actually submit to IndexNow
 *
 * Deliberately NOT wired into deploy.yml or `npm run build`: IndexNow
 * guidance discourages resubmitting an unchanged URL set, and the build runs
 * on every push including unrelated fixes. Run this by hand after a push that
 * actually changes page content or adds/removes pages.
 */
const { readFileSync, existsSync } = require('node:fs');

// This key must match the filename (minus .txt) of the file it names below —
// IndexNow requires that. It is asserted against public/bde3a252286ab1c...txt
// in src/seo/indexnow.test.ts; if the two drift, submissions get a silent 403.
const KEY = 'bde3a252286ab1c501745eaad717e807';

const SITEMAP_PATH = 'dist/sitemap.xml';
const ENDPOINT = 'https://api.indexnow.org/indexnow';

const STATUS_MEANINGS = {
  200: 'accepted',
  202: 'accepted, but the key is still pending validation',
  400: 'bad request — malformed body or invalid URL(s)',
  403: 'forbidden — the key is not valid (check the key file is live at keyLocation)',
  422: "unprocessable — the URLs don't match the host or key",
  429: 'too many requests — back off and try again later',
};

function readSitemapUrls(path) {
  if (!existsSync(path)) {
    console.error(`error: ${path} not found. Run "npm run build" first — this script submits exactly what got built, not source data.`);
    process.exit(1);
  }
  const xml = readFileSync(path, 'utf8');
  const urls = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) =>
    m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
  );
  if (urls.length === 0) {
    console.error(`error: ${path} exists but contains no <loc> entries. Refusing to submit an empty list.`);
    process.exit(1);
  }
  return urls;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const urlList = readSitemapUrls(SITEMAP_PATH);
  const host = new URL(urlList[0]).host;
  const keyLocation = `https://${host}/${KEY}.txt`;
  const body = { host, key: KEY, keyLocation, urlList };

  if (dryRun) {
    console.log('DRY RUN — nothing will be submitted.\n');
    console.log(`host:        ${body.host}`);
    console.log(`key:         ${body.key}`);
    console.log(`keyLocation: ${body.keyLocation}`);
    console.log(`urlList:     ${urlList.length} urls`);
    for (const u of urlList) console.log(`  ${u}`);
    return;
  }

  console.log(`Submitting ${urlList.length} urls for ${host} to ${ENDPOINT} ...`);
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error(`error: request to IndexNow failed: ${err.message}`);
    process.exit(1);
  }

  const meaning = STATUS_MEANINGS[res.status] ?? 'unrecognized status';
  console.log(`HTTP ${res.status} — ${meaning}`);

  if (res.status !== 200 && res.status !== 202) {
    const text = await res.text().catch(() => '');
    if (text) console.error(text);
    process.exit(1);
  }
}

main();

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
 *   node tools/run-indexnow.cjs             # DEFAULT: dry run. Prints exactly what would
 *                                            # be submitted. Sends nothing.
 *   node tools/run-indexnow.cjs --dry-run   # same as above, spelled out
 *   node tools/run-indexnow.cjs --send      # actually POSTs to IndexNow. Irreversible —
 *                                            # consumes live rate limit against a real domain.
 *
 * Dry-run is the default ON PURPOSE, not just documented: an accidental dry
 * run costs nothing, an accidental real submission cannot be recalled, and
 * `npm run seo:indexnow --dry-run` (without a `--` separator) hands the flag
 * to npm rather than this script — so the plain, no-flags command has to be
 * the safe one. Run with no arguments at all any time; it never sends.
 *
 * npm run seo:indexnow            # safe — dry run
 * npm run seo:indexnow -- --send  # the only way to actually submit
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

function buildBody(urlList) {
  const host = new URL(urlList[0]).host;
  const keyLocation = `https://${host}/${KEY}.txt`;
  return { host, key: KEY, keyLocation, urlList };
}

function printDryRun(body) {
  console.log('DRY RUN — nothing will be submitted.\n');
  console.log(`host:        ${body.host}`);
  console.log(`key:         ${body.key}`);
  console.log(`keyLocation: ${body.keyLocation}`);
  console.log(`urlList:     ${body.urlList.length} urls`);
  for (const u of body.urlList) console.log(`  ${u}`);
  console.log('\nNothing was sent. To actually submit: npm run seo:indexnow -- --send');
}

// The real sender. Kept separate from run() so tests can inject a mock here
// instead of hitting the live endpoint — this function is the only place in
// the file that performs the network call.
async function realSubmit(body) {
  console.log(`Submitting ${body.urlList.length} urls for ${body.host} to ${ENDPOINT} ...`);
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error(`error: request to IndexNow failed: ${err.message}`);
    return 1;
  }

  const meaning = STATUS_MEANINGS[res.status] ?? 'unrecognized status';
  console.log(`HTTP ${res.status} — ${meaning}`);

  if (res.status !== 200 && res.status !== 202) {
    const text = await res.text().catch(() => '');
    if (text) console.error(text);
    return 1;
  }
  return 0;
}

// --send is the only flag that reaches the network. Anything else — no
// arguments at all, or the explicit --dry-run alias — is dry-run.
function parseMode(argv) {
  return argv.includes('--send') ? 'send' : 'dry-run';
}

async function run(argv, { submit = realSubmit, sitemapPath = SITEMAP_PATH } = {}) {
  const urlList = readSitemapUrls(sitemapPath);
  const body = buildBody(urlList);
  const mode = parseMode(argv);

  if (mode === 'dry-run') {
    printDryRun(body);
    return 0;
  }

  return submit(body);
}

module.exports = { run, readSitemapUrls, buildBody, parseMode, realSubmit, KEY, SITEMAP_PATH, ENDPOINT, STATUS_MEANINGS };

if (require.main === module) {
  run(process.argv.slice(2)).then((code) => process.exit(code));
}

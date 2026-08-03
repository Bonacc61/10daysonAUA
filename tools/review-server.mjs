/**
 * Interactive coordinate reviewer.
 *
 * Serves the review UI and accepts decisions back to /tmp/coord-decisions.json,
 * so accepting a pin is a click rather than a copy-paste round trip. Decisions
 * autosave on every change — closing the tab loses nothing.
 *
 * Run:  node tools/review-server.mjs [port]
 * Then: cloudflared tunnel --url http://127.0.0.1:<port>
 *
 * Reads /tmp/coord-proposals.json, written by `npm run resolve:coords`.
 * Local-only bind; the tunnel is what exposes it.
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROPOSALS = '/tmp/coord-proposals.json';
const DECISIONS = '/tmp/coord-decisions.json';
const PORT = Number(process.argv[2] ?? 9410);

if (!existsSync(PROPOSALS)) {
  console.error(`missing ${PROPOSALS} — run: npm run resolve:coords`);
  process.exit(1);
}

const MAPBOX = (() => {
  try {
    const env = readFileSync(join(HERE, '..', '.env.production'), 'utf8');
    return (env.match(/^VITE_MAPBOX_TOKEN=(.+)$/m) || [])[1]?.trim() ?? '';
  } catch { return ''; }
})();
if (!MAPBOX) console.error('warning: no VITE_MAPBOX_TOKEN in .env.production — maps will not render');

const send = (res, code, type, body) => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
};

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    return send(res, 200, 'text/html; charset=utf-8',
      readFileSync(join(HERE, 'review-ui.html'), 'utf8').replace('__MAPBOX_TOKEN__', MAPBOX));
  }

  if (req.method === 'GET' && url.pathname === '/data') {
    const proposals = JSON.parse(readFileSync(PROPOSALS, 'utf8'));
    const decisions = existsSync(DECISIONS) ? JSON.parse(readFileSync(DECISIONS, 'utf8')) : {};
    return send(res, 200, 'application/json', JSON.stringify({ proposals, decisions }));
  }

  if (req.method === 'POST' && url.pathname === '/decisions') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 4e6) req.destroy(); });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        writeFileSync(DECISIONS, JSON.stringify(parsed, null, 1));
        const n = Object.keys(parsed).length;
        process.stdout.write(`\rdecisions saved: ${n}   `);
        send(res, 200, 'application/json', JSON.stringify({ ok: true, saved: n }));
      } catch (e) {
        send(res, 400, 'application/json', JSON.stringify({ error: String(e) }));
      }
    });
    return;
  }

  send(res, 404, 'text/plain', 'not found');
}).listen(PORT, '127.0.0.1', () => {
  console.log(`review server on http://127.0.0.1:${PORT}`);
  console.log(`decisions -> ${DECISIONS}`);
});

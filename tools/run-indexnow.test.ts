import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

// tools/run-indexnow.cjs is CommonJS (it needs `require.main === module` to
// tell "run directly" from "imported by a test" apart), so it is loaded with
// Node's own require rather than an ESM import.
const require = createRequire(import.meta.url);
const { run } = require('./run-indexnow.cjs');

/**
 * Whether IndexNow ever gets a real POST depends entirely on run()'s control
 * flow choosing to call, or not call, its `submit` dependency — so these
 * tests inject a mock submit() and assert on whether it was invoked, rather
 * than trusting any flag or log line. They never touch the network, and they
 * never point at the real dist/sitemap.xml — a small fixture sitemap is
 * built once so the tests don't depend on a prior `npm run build`.
 */
let dir: string;
let sitemapPath: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'indexnow-test-'));
  sitemapPath = join(dir, 'sitemap.xml');
  writeFileSync(
    sitemapPath,
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      '  <url><loc>https://10daysonaruba.com/</loc><lastmod>2026-09-10</lastmod></url>',
      '  <url><loc>https://10daysonaruba.com/explore</loc><lastmod>2026-09-10</lastmod></url>',
      '</urlset>',
      '',
    ].join('\n'),
  );
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('run() — dry-run is the default; only --send reaches the network', () => {
  it('with no arguments, never calls the sender', async () => {
    const submit = vi.fn().mockResolvedValue(0);
    await run([], { submit, sitemapPath });
    expect(submit, 'a no-args run reached the network sender — dry-run must be the default').not.toHaveBeenCalled();
  });

  it('--dry-run behaves identically to no arguments: sender still not called', async () => {
    const submit = vi.fn().mockResolvedValue(0);
    await run(['--dry-run'], { submit, sitemapPath });
    expect(submit).not.toHaveBeenCalled();
  });

  it('--send calls the sender exactly once, with the built submission body', async () => {
    const submit = vi.fn().mockResolvedValue(0);
    await run(['--send'], { submit, sitemapPath });
    expect(submit).toHaveBeenCalledTimes(1);
    const body = submit.mock.calls[0][0];
    expect(body.urlList).toEqual([
      'https://10daysonaruba.com/',
      'https://10daysonaruba.com/explore',
    ]);
    expect(body.host).toBe('10daysonaruba.com');
  });
});

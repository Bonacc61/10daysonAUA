import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const HTACCESS = readFileSync('public/.htaccess', 'utf8');

// Fix 7 — /i/<id> (a shared itinerary) is noindex only once React hydrates and
// applyHead() runs. robots.txt (src/seo/robots.test.ts) explicitly invites
// GPTBot, ClaudeBot and PerplexityBot, none of which execute JavaScript, so the
// served shell must carry the signal itself.
//
// This file used to grep the .htaccess TEXT for the right directives and
// passed — while the rule never actually fired in Apache. Two things were
// wrong that a text-presence check cannot see:
//
//   1. The /i/ block sat BELOW the SPA fallback's `RewriteRule . /index.html
//      [L]`. That rule is a substitution (the target differs from the
//      request), so its [L] doesn't just stop the round — it makes Apache
//      restart the whole ruleset against the new URI /index.html. Below the
//      fallback, the /i/ block's RewriteCond on REQUEST_URI only ever saw
//      "/index.html" and never matched.
//   2. Even hoisted above the fallback, Apache renames every env var to
//      REDIRECT_<name> across that same internal redirect. `env=NOINDEX_SHARE`
//      alone stops matching after the restart; only `env=REDIRECT_NOINDEX_SHARE`
//      does. Both header lines are required — neither is "the same" as the
//      other, and neither is redundant.
//
// The two tests below assert on exactly those two things: relative order in
// the file, and presence of BOTH env= header lines. Both are necessary
// conditions for the rule to fire in real Apache, verified against a real
// server (see the block comment further down) — but a text test can only ever
// prove structure, never runtime behaviour. Do not read a pass here as proof
// the header ships; re-verify behaviourally (see below) after any further
// edit to this file.
// Both rules this test locates are also named in the surrounding prose
// comments (deliberately, so nobody "tidies" the ordering back down the
// file) — so a plain string search over the whole file would match the
// comment's mention instead of the directive itself. Find them by line,
// skipping anything that is a comment.
function firstDirectiveLine(pattern: RegExp): number {
  const lines = HTACCESS.split('\n');
  return lines.findIndex((line) => !line.trim().startsWith('#') && pattern.test(line));
}

describe('.htaccess — shared itinerary noindex', () => {
  it('places the /i/ rewrite block BEFORE the SPA fallback rewrite', () => {
    // The SPA fallback's terminal rule — the one that restarts rewrite
    // processing against /index.html and hides REQUEST_URI from anything
    // below it.
    const spaFallbackLine = firstDirectiveLine(/RewriteRule \. \/index\.html \[L\]/);
    expect(spaFallbackLine, 'SPA fallback rule not found').toBeGreaterThanOrEqual(0);

    const shareCondLine = firstDirectiveLine(/RewriteCond %\{REQUEST_URI\} \^\/i\//);
    expect(shareCondLine, 'no RewriteCond on REQUEST_URI for /i/').toBeGreaterThanOrEqual(0);

    // Mutation check: move the /i/ block back below the SPA fallback (restore
    // the pre-2026-09-10 order) and this assertion must fail.
    expect(shareCondLine).toBeLessThan(spaFallbackLine);
  });

  it('sends X-Robots-Tag off BOTH the pre- and post-redirect env var names', () => {
    // Mutation check: delete either header line below and this must fail.
    expect(HTACCESS).toMatch(/Header set X-Robots-Tag "noindex, follow" env=NOINDEX_SHARE\b/);
    expect(HTACCESS).toMatch(/Header set X-Robots-Tag "noindex, follow" env=REDIRECT_NOINDEX_SHARE\b/);
  });

  it('does not disturb the SPA rewrite, the HTTPS redirect, or the cache rules', () => {
    // Non-vacuity + regression guard for the surrounding rules this fix must
    // not touch — a broken merge here would 404 every deep link or serve
    // uncached bundles, and neither failure mode is a noindex problem.
    expect(HTACCESS).toContain('RewriteRule . /index.html [L]');
    expect(HTACCESS).toMatch(/RewriteRule \^ https:\/\/%\{HTTP_HOST\}%\{REQUEST_URI\} \[L,R=301\]/);
    expect(HTACCESS).toContain('Cache-Control "public, max-age=31536000, immutable"');
  });
});

/**
 * WHAT THIS FILE CANNOT PROVE
 *
 * These are text assertions against a config file. They can catch a re-ordered
 * block or a deleted header line, but they cannot execute mod_rewrite's env-var
 * lifecycle or mod_headers' matching — only a real Apache process can. This
 * fix was verified behaviourally, not just structurally:
 *
 *   Apache 2.4.58 (Ubuntu), mod_rewrite + mod_headers loaded, mod_expires
 *   NOT loaded (matching the production host), DocumentRoot the real
 *   `dist/` with the real `public/.htaccess` copied in as `dist/.htaccess`.
 *   Verified 2026-09-10:
 *     - GET /i/abc123      -> X-Robots-Tag: noindex, follow
 *     - GET /itinerary     -> no X-Robots-Tag header
 *   A 25-path sweep additionally confirmed the header fires on exactly
 *   /i/abc123, /i/xY_9-zz, /I/abc123 and /i/, and stays absent on /i,
 *   /itinerary, /index.html, /images, /info, /imprint, /invoices/1, /,
 *   /explore, /things-to-do/*, /privacy and all static assets. Reverting the
 *   ordering (moving the /i/ block back below the SPA fallback) reproduced
 *   the original bug: no header on /i/abc123 at all. A single
 *   `Header ... "expr=%{REQUEST_URI} =~ m#^/i/#"` was also tried and also
 *   produced no header — REQUEST_URI is /index.html by the time headers are
 *   evaluated, same underlying restart.
 *
 * Re-verify the same way after any future edit to the /i/ block:
 *   1. `npm run build` (produces dist/ with the real .htaccess in it).
 *   2. Point a local Apache 2.4+ (mod_rewrite + mod_headers on, mod_expires
 *      off) at dist/ with AllowOverride All.
 *   3. `curl -sI http://localhost:<port>/i/<anything>` — must show
 *      `X-Robots-Tag: noindex, follow`.
 *   4. `curl -sI http://localhost:<port>/itinerary` (or any non-/i/ route)
 *      — must show no X-Robots-Tag header.
 */

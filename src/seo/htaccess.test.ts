import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const HTACCESS = readFileSync('public/.htaccess', 'utf8');

// Fix 7 — /i/<id> (a shared itinerary) is noindex only once React hydrates and
// applyHead() runs. robots.txt (src/seo/robots.test.ts) explicitly invites
// GPTBot, ClaudeBot and PerplexityBot, none of which execute JavaScript, so the
// served shell must carry the signal itself. mod_expires is NOT loaded on this
// host (see the comment above the cache rules) but mod_headers IS — so the fix
// has to go through mod_headers, matched by REQUEST_URI via a mod_rewrite env
// var rather than by filename (the SPA fallback means every /i/<id> request is
// ultimately served from index.html, same as every other client route).
describe('.htaccess — shared itinerary noindex', () => {
  it('tags an /i/ request with an env var by REQUEST_URI', () => {
    const rewriteBlocks = HTACCESS.split(/(?=<IfModule mod_rewrite\.c>)/).filter((b) =>
      b.startsWith('<IfModule mod_rewrite.c>'),
    );
    // Match the directive itself, not just a mention of "/i/" — the preceding
    // comment (swept into the prior block by the split above) names the route
    // too, which would make this pass even if the actual RewriteCond were gone.
    const block = rewriteBlocks.find((b) => /RewriteCond\s+%\{REQUEST_URI\}/.test(b));
    expect(block, 'no mod_rewrite block sets a RewriteCond on REQUEST_URI').toBeDefined();
    expect(block).toMatch(/RewriteCond\s+%\{REQUEST_URI\}\s+\^\/i\//);
    expect(block).toMatch(/RewriteRule\s+\^\s+-\s+\[E=(\w+):1\]/);
  });

  it('sends X-Robots-Tag: noindex, follow off that same env var, guarded by mod_headers', () => {
    const envMatch = HTACCESS.match(/RewriteRule\s+\^\s+-\s+\[E=(\w+):1\]/);
    expect(envMatch, 'no env var set for the /i/ rewrite condition').toBeDefined();
    const envName = envMatch![1];

    const headerBlocks = HTACCESS.split(/(?=<IfModule mod_headers\.c>)/).filter((b) =>
      b.startsWith('<IfModule mod_headers.c>'),
    );
    const block = headerBlocks.find((b) => b.includes(`env=${envName}`));
    expect(block, `no mod_headers block reads env=${envName}`).toBeDefined();
    expect(block).toMatch(/Header set X-Robots-Tag "noindex, follow" env=/);
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

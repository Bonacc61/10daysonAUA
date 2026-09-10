import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * Search-console ownership tokens.
 *
 * These are single-line files in public/ that Google and Bing fetch to confirm
 * we own the domain. Deleting one silently un-verifies the property: nothing
 * breaks on the site, no build fails, and the first symptom is that Search
 * Console quietly stops reporting — which is exactly when nobody is looking.
 *
 * Google's HTML-file method requires the file's CONTENT to repeat its own
 * filename, so the two are asserted against each other rather than against a
 * hardcoded copy: a rename that forgets the body, or a body edited without the
 * rename, both fail here.
 */
const GOOGLE = 'google1d264a36ee1c3697.html';

describe('search engine ownership verification', () => {
  it('keeps the Google verification file in public/', () => {
    const files = readdirSync('public');
    expect(files, 'the Google verification file was removed from public/').toContain(GOOGLE);
  });

  it('has content matching its own filename, as Google requires', () => {
    const body = readFileSync(`public/${GOOGLE}`, 'utf8').trim();
    expect(body).toBe(`google-site-verification: ${GOOGLE}`);
  });

  // public/ is copied verbatim into dist/ by Vite, and deploy.yml mirrors dist/
  // to the host — so a file here reaches https://10daysonaruba.com/<name> with
  // no routing work. The .htaccess SPA fallback only catches paths that are NOT
  // real files (RewriteCond %{REQUEST_FILENAME} !-f), so this is served as
  // itself rather than swallowed by index.html.
  it('is a plain single-line token, not markup the SPA could intercept', () => {
    const body = readFileSync(`public/${GOOGLE}`, 'utf8');
    expect(body.split('\n').filter(Boolean)).toHaveLength(1);
    expect(body).not.toContain('<');
  });
});

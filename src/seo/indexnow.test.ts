import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * IndexNow key file.
 *
 * IndexNow proves domain ownership by requiring a file at
 * https://10daysonaruba.com/<key>.txt whose CONTENTS equal the key, AND whose
 * FILENAME (minus .txt) equals the key too — both have to match the key used
 * in the submission script's request body. If any of the three drift apart,
 * IndexNow returns 403 and nothing on the live site breaks, so nobody notices
 * until search engines quietly stop being pushed updates.
 *
 * The key is hardcoded here independently of tools/run-indexnow.cjs (rather
 * than importing it), so a change to only the script — or only the file — is
 * exactly what this test is built to catch.
 */
const KEY = 'bde3a252286ab1c501745eaad717e807';
const KEY_FILE = `${KEY}.txt`;

describe('IndexNow key file', () => {
  it('exists in public/', () => {
    const files = readdirSync('public');
    expect(files, 'the IndexNow key file was removed from public/').toContain(KEY_FILE);
  });

  it('has contents exactly equal to the key', () => {
    const body = readFileSync(`public/${KEY_FILE}`, 'utf8').trim();
    expect(body).toBe(KEY);
  });

  it('has a filename (minus .txt) equal to its own contents, as IndexNow requires', () => {
    const body = readFileSync(`public/${KEY_FILE}`, 'utf8').trim();
    const filenameKey = KEY_FILE.replace(/\.txt$/, '');
    expect(filenameKey).toBe(body);
  });

  it('is a plain single-line token, not markup the SPA could intercept', () => {
    const body = readFileSync(`public/${KEY_FILE}`, 'utf8');
    expect(body.split('\n').filter(Boolean)).toHaveLength(1);
    expect(body).not.toContain('<');
  });

  it('matches the key the submission script actually sends', () => {
    const script = readFileSync('tools/run-indexnow.cjs', 'utf8');
    const match = script.match(/^const KEY = '([0-9a-f]+)';/m);
    expect(match, 'tools/run-indexnow.cjs must define a top-level const KEY').not.toBeNull();
    expect(match![1]).toBe(KEY);
  });
});

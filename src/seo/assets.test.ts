import { describe, it, expect } from 'vitest';
import { cssHrefFromManifest } from './assets';

const MANIFEST = JSON.stringify({
  'src/main.tsx': {
    file: 'assets/index-DmUJTFYN.js',
    name: 'index',
    src: 'src/main.tsx',
    isEntry: true,
    css: ['assets/index-CZLjywM4.css'],
  },
  'src/pages/Explore.tsx': { file: 'assets/Explore-aaa.js', name: 'Explore' },
});

describe('cssHrefFromManifest', () => {
  it('finds the entry chunk stylesheet and makes it site-absolute', () => {
    expect(cssHrefFromManifest(MANIFEST)).toBe('/assets/index-CZLjywM4.css');
  });

  it('throws a useful message when the entry has no css', () => {
    const bad = JSON.stringify({ 'src/main.tsx': { file: 'a.js', isEntry: true } });
    expect(() => cssHrefFromManifest(bad)).toThrow(/no stylesheet/i);
  });

  it('throws a useful message when there is no entry chunk', () => {
    const bad = JSON.stringify({ 'src/pages/Explore.tsx': { file: 'a.js' } });
    expect(() => cssHrefFromManifest(bad)).toThrow(/no entry chunk/i);
  });
});

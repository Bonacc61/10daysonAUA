import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PRIVATE_PAGES, PAGE_TO_PATH } from '../lib/pages';

const TXT = readFileSync('public/robots.txt', 'utf8');

describe('robots.txt', () => {
  it('allows the default crawler', () => {
    expect(TXT).toMatch(/^User-agent: \*$/m);
    const wildcardBlock = TXT.split(/\n(?=User-agent:)/).find((b) => b.includes('User-agent: *'));
    expect(wildcardBlock).toBeDefined();
    expect(wildcardBlock).toMatch(/^Allow: \/$/m);
    expect(wildcardBlock).not.toMatch(/^Disallow: \//m);
  });

  it('names the sitemap', () => {
    expect(TXT).toMatch(/^Sitemap: https:\/\/10daysonaruba\.com\/sitemap\.xml$/m);
  });

  // The policy is deliberate: we trade content for citations in AI answers.
  // Listing them explicitly is what makes it a decision rather than a default.
  it.each(['GPTBot', 'OAI-SearchBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended'])(
    'explicitly allows %s',
    (bot) => {
      const block = TXT.split(/\n(?=User-agent:)/).find((b) => b.includes(`User-agent: ${bot}`));
      expect(block, `no block for ${bot}`).toBeDefined();
      expect(block).toMatch(/^Allow: \/$/m);
      expect(block).not.toMatch(/^Disallow: \//m);
    },
  );

  // Blocking these here would PREVENT the noindex tag from ever being read,
  // which is the opposite of the intent. This test exists to stop a future
  // well-meant "tidy-up" from adding them.
  it('never disallows a private route — those use noindex instead', () => {
    for (const page of PRIVATE_PAGES) {
      expect(TXT).not.toContain(`Disallow: ${PAGE_TO_PATH[page]}`);
    }
    expect(TXT).not.toContain('Disallow: /i/');
  });
});

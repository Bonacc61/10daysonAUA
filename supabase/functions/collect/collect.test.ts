// The privacy-critical half of the beacon: everything that decides what text
// reaches the database. Tested here rather than through the deployed function
// because these are the rules the project's "never store a traveller's words"
// rule actually rests on — an allowlist that quietly stops allowlisting is
// invisible in production until someone reads a table.
//
// Vitest, not Deno.test, matching viator-cards/normalize.test.ts: these are pure
// functions with no Deno runtime surface, so they belong to `npm test`.
import { describe, it, expect } from 'vitest';
import { normalisePath, referrerHost, campaign, deviceClass, lookupIp, BOT_RE } from './normalise';

describe('collect — path normalisation is an allowlist', () => {
  it('keeps the app\'s own routes', () => {
    for (const p of ['/', '/explore', '/itinerary', '/map', '/questionnaire', '/privacy', '/dashboard']) {
      expect(normalisePath(p)).toBe(p);
    }
  });

  it('DROPS the query string before anything else', () => {
    // The whole reason this runs first: a search query in a URL is a
    // traveller's typed words, and storing those is forbidden outright.
    expect(normalisePath('/explore?q=romantic%20sunset%20for%20our%20anniversary')).toBe('/explore');
    expect(normalisePath('/?ref=reddit&utm_source=whatever')).toBe('/');
  });

  it('collapses the share slug, so a pageview cannot name one itinerary', () => {
    expect(normalisePath('/i/aB3xQ')).toBe('/i/:slug');
    expect(normalisePath('/i/aB3xQ?from=email')).toBe('/i/:slug');
  });

  it('sends anything unrecognised to "other" rather than cleaning it up', () => {
    // An allowlist, not a sanitiser. "Clean it up and store it" is how free text
    // ends up in a database one unusual URL at a time.
    expect(normalisePath('/wp-admin')).toBe('other');
    expect(normalisePath('/../../etc/passwd')).toBe('other');
    expect(normalisePath('/explore/romantic-dinner-for-two')).toBe('other');
    expect(normalisePath(undefined)).toBe('other');
    expect(normalisePath(42)).toBe('other');
  });

  it('treats a trailing slash as the same route', () => {
    expect(normalisePath('/explore/')).toBe('/explore');
  });
});

describe('collect — referrer is reduced to a host', () => {
  it('keeps the host and drops the path, so no thread URL is stored', () => {
    expect(referrerHost('https://www.reddit.com/r/aruba/comments/xyz/our_trip/')).toBe('reddit.com');
    expect(referrerHost('https://news.ycombinator.com/item?id=123')).toBe('news.ycombinator.com');
  });

  it('returns null for junk rather than storing it', () => {
    for (const v of ['', 'not a url', undefined, null, 12]) expect(referrerHost(v)).toBeNull();
  });
});

describe('collect — campaign is allowlisted, not sanitised', () => {
  it('accepts the shape you control', () => {
    expect(campaign('reddit-aruba-aug')).toBe('reddit-aruba-aug');
  });

  it('rejects everything else, including anything with room for prose', () => {
    for (const v of ['Reddit Aruba', 'a'.repeat(33), '<script>', 'ref=1&x=2', '', undefined, 7]) {
      expect(campaign(v)).toBeNull();
    }
  });
});

describe('collect — bot filter', () => {
  it('drops the crawlers a launch actually attracts', () => {
    for (const ua of [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; bingbot/2.0)',
      'facebookexternalhit/1.1',
      'Twitterbot/1.0',
      'redditbot/1.0',
      'curl/8.4.0',
      'python-requests/2.31.0',
      'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120',
    ]) expect(BOT_RE.test(ua), ua).toBe(true);
  });

  it('does NOT drop real browsers', () => {
    for (const ua of [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    ]) expect(BOT_RE.test(ua), ua).toBe(false);
  });
});

describe('collect — device class', () => {
  it('buckets the three cases', () => {
    expect(deviceClass('iPhone; CPU iPhone OS 17_0 Mobile/15E148')).toBe('mobile');
    expect(deviceClass('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('tablet');
    expect(deviceClass('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120')).toBe('desktop');
  });

  it('calls an Android tablet a tablet, not a phone', () => {
    // Android tablets omit "Mobile"; that absence is the only signal there is.
    expect(deviceClass('Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 Chrome/120 Safari/537.36')).toBe('tablet');
    expect(deviceClass('Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36')).toBe('mobile');
  });
});

describe('collect — only a real address is sent to the country lookup', () => {
  it('accepts the two address families', () => {
    for (const ip of [
      '145.100.0.1',
      '85.10.159.81',
      '2001:610::1',
      '2001:4860:4860::8888',
      '::1',
    ]) expect(lookupIp(ip), ip).toBe(ip);
  });

  it('rejects "unknown", which is what clientIp returns with no forwarded header', () => {
    // Not hypothetical: clientIp falls back to the literal string 'unknown'
    // whenever x-forwarded-for is absent. Postgres would reject it as invalid
    // inet input, and the round trip would be spent to learn nothing.
    expect(lookupIp('unknown')).toBe(null);
  });

  it('rejects anything that is not an address, since this value comes from a header', () => {
    for (const junk of [
      '', ' ', 'localhost', '999.1.1.1', '1.2.3', '1.2.3.4.5',
      '145.100.0.1; drop table web_events',
      '2001:610::1 ',
      'g001:610::1',
      '../../etc/passwd',
      'x'.repeat(200),
    ]) expect(lookupIp(junk), JSON.stringify(junk)).toBe(null);
  });

  it('unmaps an IPv4-mapped address instead of passing it through', () => {
    // ::ffff:145.100.0.1 is a valid inet value, so this is not about rejection.
    // It sorts into IPv6 space, where the dataset's first range is the ZZ block
    // covering ::/3 — so passed through as-is it resolves to NO country, for
    // every visitor behind a proxy that emits this form, silently.
    expect(lookupIp('::ffff:145.100.0.1')).toBe('145.100.0.1');
    expect(lookupIp('::FFFF:85.10.159.81')).toBe('85.10.159.81');
    // Still junk once unmapped.
    expect(lookupIp('::ffff:999.1.1.1')).toBe(null);
  });

  it('does not accept a CIDR block or a port, which are not single addresses', () => {
    expect(lookupIp('145.100.0.0/16')).toBe(null);
    expect(lookupIp('145.100.0.1:443')).toBe(null);
  });
});

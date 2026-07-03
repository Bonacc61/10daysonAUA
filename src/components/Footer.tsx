import type { PageId } from '../App';

type Props = { setPage: (p: PageId) => void };

export default function Footer({ setPage }: Props) {
  // Short build id, injected at build time (see vite.config.ts). Lets us confirm
  // at a glance which deploy a browser is actually running — no more guessing
  // whether a fix has loaded or is stale in cache.
  const build = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'dev';
  return (
    <div className="bleed" style={{ background: 'var(--ink)', color: 'var(--cream)', textAlign: 'center' }}>
      <div className="container-1280 footer-content" style={{ padding: '28px 36px' }}>
        <img
          /* New light/dark-green logo (same file as the nav). Footer bg is dark
             (var(--ink)), so check legibility of the dark-green parts; swap to a
             dedicated dark-bg variant here if it reads poorly. ?v= token matches
             Nav.tsx — bump both when the logo file is replaced. */
          src="/logo-horizontal.png?v=20260621"
          alt="10 days on Aruba"
          style={{ height: 30, width: 'auto', display: 'inline-block', verticalAlign: 'middle' }}
        />
        <div style={{ fontSize: 12, color: '#888', marginTop: 10 }}>Made on the island. ♥</div>
        <p style={{
          fontSize: 11, color: 'var(--sand-500)',
          margin: '12px auto 0', maxWidth: 480,
        }}>
          Some links on this site are affiliate links. If you book through them, we may
          earn a small commission at no extra cost to you. We only recommend things we'd
          send a friend to.
        </p>
        <div style={{ marginTop: 16 }}>
          <button
            onClick={() => setPage('privacy')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#666', fontFamily: 'inherit', padding: 0, textDecoration: 'underline' }}
          >
            Privacy Policy
          </button>
        </div>
        <div style={{ fontSize: 10, color: '#555', marginTop: 10, letterSpacing: '0.04em' }}>
          build {build}
        </div>
      </div>
    </div>
  );
}

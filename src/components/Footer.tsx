import type { PageId } from '../App';
import { Instagram, Coffee } from './Icons';
import { PAGE_TO_PATH } from '../lib/pages';

/**
 * An in-app navigation that is also a real link.
 *
 * Every internal navigation on this site used to be a <button onClick>. That is
 * invisible to a crawler — there was no path from any page to any other page,
 * so nothing could be discovered by following links and no link equity moved.
 *
 * The href is what a crawler reads; preventDefault on a plain click is what
 * keeps the SPA navigation instant. Modifier-clicks and middle-clicks fall
 * through to the browser deliberately, so open-in-new-tab works — it never did
 * while these were buttons.
 */
export function SpaLink({
  page, setPage, children, className, style,
}: {
  page: PageId;
  setPage: (p: PageId) => void;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <a
      href={PAGE_TO_PATH[page]}
      className={className}
      style={style}
      onClick={(e) => {
        // e.button !== 0: defensive only. A real middle click on an <a> fires
        // auxclick, not click, in Chrome and Firefox, so this branch is not
        // reachable that way — the browser's native new-tab behaviour happens
        // regardless. Kept for a synthesized click that carries a non-zero button.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        setPage(page);
      }}
    >
      {children}
    </a>
  );
}

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
        <div style={{ marginTop: 14, display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <a
            href="https://www.instagram.com/10daysonaruba/"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              color: 'var(--cream)',
              textDecoration: 'none',
              fontSize: 12,
              fontWeight: 500,
              padding: '6px 14px',
              borderRadius: 20,
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              transition: 'background 0.2s ease, border-color 0.2s ease',
            }}
          >
            <Instagram size={15} sw={2} />
            <span>Follow us</span>
          </a>
          <a
            href="https://www.buymeacoffee.com/hello3v"
            target="_blank"
            rel="noopener noreferrer"
            /* Brand-yellow support pill (Buy Me a Coffee's own colour too), with the
               site's neobrutalist ink shadow so it pops against the dark footer. */
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              color: 'var(--ink)',
              textDecoration: 'none',
              fontSize: 12,
              fontWeight: 700,
              padding: '6px 14px',
              borderRadius: 20,
              background: 'var(--yellow)',
              border: '1.5px solid var(--ink)',
              boxShadow: '2px 2px 0 rgba(0, 0, 0, 0.55)',
            }}
          >
            <Coffee size={15} sw={2} />
            <span>Buy me a coffee</span>
          </a>
        </div>
        <p style={{
          fontSize: 11, color: 'var(--sand-500)',
          margin: '12px auto 0', maxWidth: 480,
        }}>
          Some links on this site are affiliate links. If you book through them, we may
          earn a small commission at no extra cost to you. We only recommend things we'd
          send a friend to.
        </p>
        <div style={{ marginTop: 16, display: 'flex', gap: 16, justifyContent: 'center' }}>
          <SpaLink page="privacy" setPage={setPage}
            style={{ fontSize: 11, color: '#666', textDecoration: 'underline' }}>
            Privacy Policy
          </SpaLink>
          <SpaLink page="terms" setPage={setPage}
            style={{ fontSize: 11, color: '#666', textDecoration: 'underline' }}>
            Terms of Service
          </SpaLink>
        </div>
        <div style={{ fontSize: 10, color: '#555', marginTop: 10, letterSpacing: '0.04em' }}>
          build {build}
        </div>
      </div>
    </div>
  );
}

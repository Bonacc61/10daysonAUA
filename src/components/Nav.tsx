import type { PageId } from '../App';
import { useAuth } from '../lib/auth';

type Props = {
  page: PageId;
  setPage: (p: PageId) => void;
  onLogin: () => void;
};

export default function Nav({ page, setPage, onLogin }: Props) {
  const { user } = useAuth();

  const link = (id: PageId, label: string, keepOnMobile = false) => (
    <button
      key={id}
      onClick={() => setPage(id)}
      className={keepOnMobile ? 'nav-link-explore' : 'nav-link-text'}
      style={{
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: 14,
        fontWeight: page === id ? 700 : 500,
        color: page === id ? 'var(--red)' : 'var(--ink)',
        borderBottom: page === id ? '2px solid var(--red)' : '2px solid transparent',
        padding: '6px 2px',
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="bleed" style={{ background: 'var(--cream)', borderBottom: '2px solid var(--ink)' }}>
      <div
        className="container-1280 nav-row"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 36px' }}
      >
        <button
          onClick={() => setPage('landing')}
          aria-label="10 days on Aruba — home"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' }}
        >
          <img
            className="nav-logo"
            /* ?v= cache-buster: iOS Safari caches images by URL very aggressively,
               so it kept serving the old logo. Bump this token whenever the file
               at public/logo-horizontal.png is replaced to force a fresh fetch. */
            src="/logo-horizontal.png?v=20260621"
            alt="10 days on Aruba"
            style={{ height: 38, width: 'auto', display: 'block' }}
          />
        </button>
        <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
          {link('landing', 'How it works')}
          {link('explore', 'Explore', true)}
          {link('itinerary', 'Itinerary')}
          <button
            className="nav-login"
            onClick={() => (user ? setPage('itinerary') : onLogin())}
            title={user ? `Signed in as ${user.email}` : undefined}
          >
            {user ? 'My trip' : 'Log in'}
          </button>
        </div>
      </div>
    </div>
  );
}

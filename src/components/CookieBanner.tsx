import { useState } from 'react';
import { CONSENT_KEY, initAnalytics } from '../lib/analytics';

type Consent = 'true' | 'false' | null;

function readConsent(): Consent {
  try { return localStorage.getItem(CONSENT_KEY) as Consent; } catch { return null; }
}

function writeConsent(value: 'true' | 'false') {
  try { localStorage.setItem(CONSENT_KEY, value); } catch { /* ignore */ }
}

export default function CookieBanner({ onPrivacy }: { onPrivacy: () => void }) {
  const [visible, setVisible] = useState(() => readConsent() === null);

  if (!visible) return null;

  const accept = () => {
    writeConsent('true');
    initAnalytics();
    setVisible(false);
  };

  const decline = () => {
    writeConsent('false');
    setVisible(false);
  };

  return (
    <div className="cookie-banner" role="dialog" aria-label="Cookie consent">
      <p className="cookie-text">
        We use analytics to improve the app.{' '}
        <button className="cookie-link" onClick={onPrivacy} type="button">
          Privacy policy
        </button>
      </p>
      <div className="cookie-actions">
        <button className="cookie-btn cookie-decline" onClick={decline} type="button">
          Decline
        </button>
        <button className="cookie-btn cookie-accept" onClick={accept} type="button">
          Accept
        </button>
      </div>
    </div>
  );
}

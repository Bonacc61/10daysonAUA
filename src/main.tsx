import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { initAnalytics, CONSENT_KEY } from './lib/analytics';

// Only initialise PostHog if the user has already accepted analytics in a prior
// session. First-time visitors get the CookieBanner; on accept it calls
// initAnalytics() directly so tracking starts without a reload.
if (localStorage.getItem(CONSENT_KEY) === 'true') {
  initAnalytics();
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

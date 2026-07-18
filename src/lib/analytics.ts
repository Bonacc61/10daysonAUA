// Thin PostHog wrapper. All analytics calls go through here so the rest of the
// app never imports posthog-js directly and the whole thing is no-op when the
// key is absent (local dev without a .env entry, or CI).
//
// GDPR: PostHog must not initialise until the user explicitly accepts analytics.
// Call initAnalytics() only after reading CONSENT_KEY === 'true' from localStorage
// or after the user clicks Accept in the CookieBanner.
import posthog from 'posthog-js';

export const CONSENT_KEY = '10doa:analytics-consent';

const KEY  = import.meta.env.VITE_POSTHOG_KEY  as string | undefined;
const HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? 'https://eu.i.posthog.com';

export function initAnalytics(): void {
  if (!KEY) return;
  posthog.init(KEY, {
    api_host: HOST,
    // EU cloud — no data leaves the EU.
    ui_host: 'https://eu.posthog.com',
    // Page-view and page-leave events captured automatically.
    capture_pageview: true,
    capture_pageleave: true,
    // Autocapture off: avoids accidentally capturing form field values.
    autocapture: false,
    // Only create person profiles for identified users (signed-in).
    person_profiles: 'identified_only',
  });
}

// Call once after successful sign-in. Uses Supabase UUID — no email stored.
export function identifyUser(userId: string, isNew: boolean): void {
  if (!KEY) return;
  posthog.identify(userId);
  if (isNew) posthog.capture('account_created');
}

export function resetUser(): void {
  if (!KEY) return;
  posthog.reset();
}

export function capture(event: string, properties?: Record<string, unknown>): void {
  if (!KEY) return;
  posthog.capture(event, properties);
}

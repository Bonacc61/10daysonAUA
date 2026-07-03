import {
  assert, assertStringIncludes, assertEquals,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { notificationEmail, autoReplyEmail, escapeHtml } from './messages.ts';

Deno.test('notificationEmail carries all fields with a phone fallback', () => {
  const n = notificationEmail({
    name: 'Jan Kloes', email: 'jan@example.com', phone: null,
    comment: 'Loved the itinerary!', created_at: '2026-07-03T12:00:00Z',
  });
  assertStringIncludes(n.subject, 'Jan Kloes');
  assertStringIncludes(n.text, 'jan@example.com');
  assertStringIncludes(n.text, 'Phone: —'); // null phone → em dash
  assertStringIncludes(n.text, 'Loved the itinerary!');
  assertStringIncludes(n.text, 'Submitted:');
});

Deno.test('notificationEmail handles an empty comment', () => {
  const n = notificationEmail({ name: 'A', email: 'a@b.co' });
  assertStringIncludes(n.text, '(no message)');
});

Deno.test('autoReplyEmail greets by first name in text and HTML', () => {
  const r = autoReplyEmail({ name: 'Jan Kloes', email: 'jan@example.com' });
  assertEquals(r.subject, 'Thanks for reaching out — 10 Days on Aruba');
  assertStringIncludes(r.text, 'Hi Jan,');
  assertStringIncludes(r.html, 'Hi <strong>Jan</strong>');
  assertStringIncludes(r.html, 'https://10daysonaruba.com/parrot.png');
  assertStringIncludes(r.html, 'https://10daysonaruba.com/logo-horizontal.png');
});

Deno.test('autoReplyEmail falls back to "there" when name is blank', () => {
  const r = autoReplyEmail({ name: '   ', email: 'a@b.co' });
  assertStringIncludes(r.text, 'Hi there,');
});

Deno.test('escapeHtml neutralizes markup so a name cannot inject HTML', () => {
  assertEquals(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  const r = autoReplyEmail({ name: '<b>Eve</b>', email: 'e@x.co' });
  assert(!r.html.includes('<b>Eve</b>'));
  assertStringIncludes(r.html, '&lt;b&gt;Eve&lt;/b&gt;');
});

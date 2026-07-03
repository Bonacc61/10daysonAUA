import type { PlannedDay, PlannedCard } from '../data/itineraryPlan';
import type { Answers } from '../App';
import type { CardEntry, Slot, SlotEntry } from '../types';

// Aruba is UTC-4 all year (no DST). Slot start times in Aruba local hours.
const SLOT_HOUR: Record<Slot, number> = { morning: 9, afternoon: 13, evening: 19 };

function parseDurationMins(dur: string | undefined): number {
  if (!dur) return 120;
  if (/full day/i.test(dur)) return 480;
  const m = dur.match(/(\d+)/);
  return m ? parseInt(m[1], 10) * 60 : 120;
}

function pad(n: number): string { return String(n).padStart(2, '0'); }

// Formats a local Aruba datetime to YYYYMMDDTHHMMSS (no Z = local time in TZID).
function fmtDt(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
}

// ICS text escaping per RFC 5545 §3.3.11.
function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

// RFC 5545 line-folding: lines > 75 octets must be wrapped with CRLF + SPACE.
function fold(line: string): string {
  const out: string[] = [];
  while (line.length > 75) {
    out.push(line.slice(0, 75));
    line = ' ' + line.slice(75);
  }
  out.push(line);
  return out.join('\r\n');
}

export function buildIcs(
  plan: PlannedDay[],
  answers: Answers,
  resolve: (e: SlotEntry, slot?: Slot) => CardEntry | null,
  bookedIds: Set<string>,
): string {
  // Trip start = today + startOffset days (answers.startOffset is days from now).
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  base.setDate(base.getDate() + (answers.startOffset ?? 7));

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//10 Days on Aruba//Itinerary//EN',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:10 Days on Aruba',
    'X-WR-TIMEZONE:America/Aruba',
    // Aruba = UTC-4 all year, no DST.
    'BEGIN:VTIMEZONE',
    'TZID:America/Aruba',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:-0400',
    'TZOFFSETTO:-0400',
    'TZNAME:AST',
    'END:STANDARD',
    'END:VTIMEZONE',
  ];

  for (const day of plan) {
    const dayDate = new Date(base);
    dayDate.setDate(base.getDate() + (day.day - 1));

    for (const slot of (['morning', 'afternoon', 'evening'] as Slot[])) {
      for (const card of (day[slot] as PlannedCard[])) {
        const entry = resolve(card.entry, slot);
        if (!entry) continue;

        const title    = entry.kind === 'activity' ? entry.activity.title       : entry.bestSeller.title;
        const location = entry.kind === 'activity' ? entry.activity.location    : '';
        const desc     = entry.kind === 'activity' ? entry.activity.description : (entry.bestSeller.description ?? '');
        const rawDur   = entry.kind === 'activity' ? entry.activity.duration    : undefined;

        const start = new Date(dayDate);
        start.setHours(SLOT_HOUR[slot], 0, 0, 0);
        const end = new Date(start);
        end.setMinutes(end.getMinutes() + parseDurationMins(rawDur));

        const booked  = bookedIds.has(card.uid);
        const summary = booked ? `✓ ${title}` : title;
        const status  = booked ? 'CONFIRMED' : 'TENTATIVE';

        const event: string[] = [
          'BEGIN:VEVENT',
          fold(`DTSTART;TZID=America/Aruba:${fmtDt(start)}`),
          fold(`DTEND;TZID=America/Aruba:${fmtDt(end)}`),
          fold(`SUMMARY:${esc(summary)}`),
          fold(`DESCRIPTION:${esc(desc)}`),
          `STATUS:${status}`,
        ];
        if (location) event.push(fold(`LOCATION:${esc(location)}`));
        event.push('END:VEVENT');
        lines.push(...event);
      }
    }
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export function downloadIcs(content: string, filename = '10-days-on-aruba.ics'): void {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

import type { Coord } from './coords';

/**
 * The pin registry — the single source of truth for where an activity happens.
 *
 * Coordinates are researched ONCE, offline, per item (tools/resolve-coords.ts)
 * and committed here. Nothing resolves at runtime. Because the data is static and
 * committed, any coordinate change appears in a normal diff and goes through
 * /code-review — the registry is its own audit baseline.
 *
 * An id absent from ITEM_PINS draws NO PIN. That is a supported state, not a gap:
 * Map.tsx keeps the card in the photo strip and omits the marker. There is
 * deliberately no fallback coordinate anywhere in the codebase — the six invented
 * GROUP_COORDS centroids this replaces gave ~340 catalog items a coordinate the
 * map drew as fact and the engine treated as geography.
 *
 * See docs/superpowers/specs/2026-08-03-map-pin-accuracy-design.md and
 * docs/matching-engine/geography.md.
 */

export type PinSource =
  | 'known-place'   // named Aruba place matched from the product title, cited
  | 'departure'     // no fixed destination; the departure point IS where it happens
  | 'curated';      // hand-verified editorial activity

/**
 * Where the traveller is collected, when a real named departure point is known.
 *
 * Curated, never fetched. The 2026-08-03 probe found Viator cannot supply this at
 * usable quality — only 3 of 24 meeting-point refs resolved to coordinates, and
 * those were hotels on a pickup round rather than departure points. Cards without
 * a pickup defer to the Viator booking link, which is authoritative for what a
 * traveller must actually do on the day. See docs/map/viator-location-probe.md.
 */
export type Pickup = { coord: Coord; name: string; time?: string };

export type Pin = {
  coord: Coord;
  source: PinSource;
  cite: string;      // REQUIRED — a reference a human can check. Enforced by test.
  place?: string;    // human-readable place name, shown on the card
  pickup?: Pickup;
};

export const ITEM_PINS: Record<string, Pin> = {
  // ── Curated editorial activities ────────────────────────────────────────────
  // Migrated verbatim from the old ACTIVITY_COORDS; citations lifted from the
  // trailing comments that table already carried.
  'eagle-beach-morning':          { coord: { lng: -70.0579, lat: 12.5492 }, source: 'curated', place: 'Eagle Beach',           cite: 'Wikipedia: Beaches of Aruba' },
  'baby-beach-snorkel':           { coord: { lng: -69.8808, lat: 12.4138 }, source: 'curated', place: 'Baby Beach',            cite: 'Wikipedia: Beaches of Aruba' },
  'arikok-hiking':                { coord: { lng: -69.9265, lat: 12.4988 }, source: 'curated', place: 'Arikok National Park',  cite: 'Wikipedia: Arikok National Park / latitude.to' },
  'california-lighthouse-sunset': { coord: { lng: -70.0514, lat: 12.6138 }, source: 'curated', place: 'California Lighthouse', cite: 'Wikipedia: California Lighthouse infobox' },
  'flamingo-renaissance':         { coord: { lng: -70.0293, lat: 12.5009 }, source: 'curated', place: 'Renaissance Island',    cite: 'latlong.net: Renaissance Island' },
  'boca-catalina-snorkel':        { coord: { lng: -70.0515, lat: 12.6046 }, source: 'curated', place: 'Boca Catalina',         cite: 'Wikipedia: Beaches of Aruba' },
  'antilla-wreck-dive':           { coord: { lng: -70.0580, lat: 12.6020 }, source: 'curated', place: 'SS Antilla wreck',      cite: 'Wikipedia: SS Antilla' },
  'zeerovers-fresh-catch':        { coord: { lng: -69.9466, lat: 12.4461 }, source: 'curated', place: 'Zeerover, Savaneta',    cite: 'Tripexpert / OSM: Savaneta 270A pier' },
  'gasparito-restaurant':         { coord: { lng: -70.0415, lat: 12.5618 }, source: 'curated', place: 'Gasparito, Noord',      cite: 'Mapcarta' },
  'oranjestad-walking':           { coord: { lng: -70.0270, lat: 12.5240 }, source: 'curated', place: 'Oranjestad',            cite: 'latitude.to: Oranjestad' },
  'kitesurfing-lesson':           { coord: { lng: -70.0471, lat: 12.5858 }, source: 'curated', place: 'Hadicurari Beach',      cite: 'Hadicurari Beach — beginner kite lessons' },
  'natural-pool-jeep':            { coord: { lng: -69.9287, lat: 12.5246 }, source: 'curated', place: 'Conchi (Natural Pool)', cite: 'Wikipedia: Natural Pool (Aruba)' },
  // Was -70.0500, 12.5980 — flagged by the precision check as suspiciously round
  // and confirmed ~300m off against the OSM beach feature. Corrected 2026-08-03.
  'malmok-beach':                 { coord: { lng: -70.0509, lat: 12.6007 }, source: 'curated', place: 'Malmok Beach',          cite: 'OpenStreetMap: Malmok Beach (beach feature), verified 2026-08-03' },
  'tres-trapi':                   { coord: { lng: -70.0555, lat: 12.5579 }, source: 'curated', place: 'Tres Trapi',            cite: 'PADI dive site listing' },
  'manchebo-beach':               { coord: { lng: -70.0580, lat: 12.5402 }, source: 'curated', place: 'Manchebo Beach',        cite: 'Wikipedia: Beaches of Aruba (onshore)' },
  'divi-beach':                   { coord: { lng: -70.0542, lat: 12.5259 }, source: 'curated', place: 'Druif Beach',           cite: 'latitude.to: Druif Beach' },
  'mangel-halto':                 { coord: { lng: -69.9695, lat: 12.4649 }, source: 'curated', place: 'Mangel Halto',          cite: 'Wikipedia: Mangel Halto' },
  'rodgers-beach':                { coord: { lng: -69.8841, lat: 12.4172 }, source: 'curated', place: "Rodger's Beach",        cite: 'Wikipedia: Beaches of Aruba' },
  'boca-grandi':                  { coord: { lng: -69.8739, lat: 12.4402 }, source: 'curated', place: 'Boca Grandi',           cite: 'Wikipedia: Beaches of Aruba' },

  // ── Curated lunch spots (outside the Viator catalog) ────────────────────────
  // The old table described these as "town-level approximations" — precise-looking
  // but only accurate to the neighbourhood. Carried over unchanged so this stays a
  // pure migration; Task 5 re-researches them to real addresses and replaces these
  // citations. The precision validator cannot catch a coordinate that is precise
  // but wrong, so the citation is the only thing flagging them.
  'lunch-zeerover':         { coord: { lng: -69.9466, lat: 12.4461 }, source: 'curated', place: 'Zeerover, Savaneta', cite: 'Savaneta pier (town-level; migrated from coords.ts, pending re-research)' },
  // Was -69.9086, 12.4300 (town-level) — ~570m off. Now the actual restaurant node.
  'lunch-oniels':           { coord: { lng: -69.9097, lat: 12.4351 }, source: 'curated', place: "O'Niel Caribbean Kitchen, San Nicolas", cite: 'OpenStreetMap: O\'Niel Caribbean Kitchen, Van de Veen Zeppenfeldstraat 13, verified 2026-08-03' },
  'lunch-hadicurari':       { coord: { lng: -70.0475, lat: 12.5865 }, source: 'curated', place: 'Hadicurari, Noord',  cite: 'Hadicurari beach (town-level; migrated from coords.ts, pending re-research)' },
  'lunch-pikas-corner':     { coord: { lng: -70.0375, lat: 12.5720 }, source: 'curated', place: 'Palm Beach',         cite: 'Palm Beach (town-level; migrated from coords.ts, pending re-research)' },
  'lunch-don-jacinto':      { coord: { lng: -70.0270, lat: 12.5240 }, source: 'curated', place: 'Oranjestad',         cite: 'Oranjestad (town-level; migrated from coords.ts, pending re-research)' },
  'lunch-pastechi-house':   { coord: { lng: -70.0180, lat: 12.5220 }, source: 'curated', place: 'Oranjestad',         cite: 'Oranjestad (town-level; migrated from coords.ts, pending re-research)' },
  'lunch-las-cafeteros':    { coord: { lng: -70.0010, lat: 12.5350 }, source: 'curated', place: 'Tanki Leendert',     cite: 'Tanki Leendert (town-level; migrated from coords.ts, pending re-research)' },
  'lunch-willems-pancakes': { coord: { lng: -70.0400, lat: 12.5750 }, source: 'curated', place: 'Noord',              cite: 'Noord (town-level; migrated from coords.ts, pending re-research)' },
  'lunch-lindas-pancakes':  { coord: { lng: -70.0415, lat: 12.5760 }, source: 'curated', place: 'Noord',              cite: 'Noord (town-level; migrated from coords.ts, pending re-research)' },
  'lunch-bingo':            { coord: { lng: -70.0420, lat: 12.5740 }, source: 'curated', place: 'Noord',              cite: 'Noord (town-level; migrated from coords.ts, pending re-research)' },
};

/** Look up a pin. Returns undefined — never a fallback — for unregistered ids. */
export function pinFor(id: string): Pin | undefined {
  return ITEM_PINS[id];
}

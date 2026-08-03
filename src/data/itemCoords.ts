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

/**
 * An additional place a multi-stop activity visits.
 *
 * "Aruba Island Private Jeep Tour Arikok Park & Baby beach" genuinely happens in
 * two places 25km apart. Forcing it onto one coordinate would put the pin on a
 * spot the traveller spends half the day away from — the same class of untruth
 * this whole registry exists to remove.
 */
export type Stop = { coord: Coord; place?: string; cite: string; offshore?: true };

export type Pin = {
  /**
   * The PRIMARY location. For a single-location activity this is the whole
   * story; for a multi-stop one it is the headline destination — the place a
   * traveller would say the tour is about.
   *
   * The itinerary engine reads only this (`entryCoord`, itineraryGenerator.ts),
   * because day-clustering needs exactly one anchor point per pick. The map
   * draws this plus every entry in `stops`.
   */
  coord: Coord;
  source: PinSource;
  cite: string;      // REQUIRED — a reference a human can check. Enforced by test.
  place?: string;    // human-readable place name, shown on the card
  /**
   * Further locations this activity visits, beyond `coord`. Ordered as the
   * activity visits them where that is known. Map-only: these draw extra
   * markers sharing the primary's card, and never reach the engine.
   */
  stops?: Stop[];
  pickup?: Pickup;
  /**
   * Set when the coordinate is a deliberate approximation rather than the exact
   * spot — currently, departure pins placed on the hotel a Viator meeting-point
   * description names, when the actual pier is on that hotel's beach.
   *
   * Measured example: "our pier located behind the Hyatt Regency" pins on the
   * Hyatt, which sits 162m from the shoreline; the pier is past that, over the
   * water. Right beach, right hotel, ~150-200m out.
   *
   * Kept as a flag rather than left implicit in the citation so the audit can
   * count approximations without parsing prose, and so the card can label them
   * if that is ever wanted. `cite` still carries the operator's exact wording.
   */
  approx?: true;
  /**
   * Set for pins that legitimately sit away from the main island landmass:
   * wreck and reef dive sites, and offshore islets such as De Palm Island
   * (628m out) and Renaissance Island. Absent means "on the main island", which
   * is the overwhelming majority.
   *
   * Not called `terrain: 'water'` because De Palm Island is genuine land — it is
   * simply not the land the coastline polygon describes.
   *
   * Exists so the land/sea validator stays strict by default: a mainland pin
   * more than 500m out to sea is a research error, while the SS Antilla wreck
   * at 667m is correct. The alternative — a hand-maintained list of exempt ids
   * inside the test — would rot silently as the catalog changes.
   */
  offshore?: true;
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
  'antilla-wreck-dive':           { coord: { lng: -70.0580, lat: 12.6020 }, source: 'curated', place: 'SS Antilla wreck',      cite: 'Wikipedia: SS Antilla', offshore: true },
  'zeerovers-fresh-catch':        { coord: { lng: -69.9466, lat: 12.4461 }, source: 'curated', place: 'Zeerover, Savaneta',    cite: 'Tripexpert / OSM: Savaneta 270A pier' },
  'gasparito-restaurant':         { coord: { lng: -70.0415, lat: 12.5618 }, source: 'curated', place: 'Gasparito, Noord',      cite: 'Mapcarta' },
  'oranjestad-walking':           { coord: { lng: -70.0270, lat: 12.5240 }, source: 'curated', place: 'Oranjestad',            cite: 'latitude.to: Oranjestad' },
  'kitesurfing-lesson':           { coord: { lng: -70.0471, lat: 12.5858 }, source: 'curated', place: 'Hadicurari Beach',      cite: 'Hadicurari Beach — beginner kite lessons' },
  'natural-pool-jeep':            { coord: { lng: -69.9287, lat: 12.5246 }, source: 'curated', place: 'Conchi (Natural Pool)', cite: 'Wikipedia: Natural Pool (Aruba)' },
  // Was -70.0500, 12.5980 — flagged by the precision check as suspiciously round
  // and confirmed ~300m off against the OSM beach feature. Corrected 2026-08-03.
  'malmok-beach':                 { coord: { lng: -70.0509, lat: 12.6007 }, source: 'curated', place: 'Malmok Beach',          cite: 'OpenStreetMap: Malmok Beach (beach feature), verified 2026-08-03' },
  // Was -70.0555, 12.5579 (cited to a PADI listing) — that is 4.94km away, near
  // Palm Beach, where no such spot exists. Tres Trapi is in Malmok, between
  // Boca Catalina and Arashi. Two independent OSM features of the same name (the
  // beach and the bus stop serving it) agree on this point. Corrected 2026-08-03.
  'tres-trapi':                   { coord: { lng: -70.0513, lat: 12.6024 }, source: 'curated', place: 'Tres Trapi, Malmok',    cite: 'OpenStreetMap: Tres Trapi beach + bus stop, Malmok; verified 2026-08-03' },
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
  // ── Viator catalog items ────────────────────────────────────────────────────
  // Resolved by tools/resolve-coords.ts, reviewed one by one in the interactive
  // reviewer, and written from the saved decisions — coordinates copied, never
  // retyped. Items absent from this list were reviewed and declined, or have no
  // determinable location; either way they draw no pin.
  '117113P2': { coord: { lng: -69.909, lat: 12.4364 }, source: 'known-place', place: 'San Nicolas', cite: 'OpenStreetMap node/13111662192, verified 2026-08-03' },  // The Whole Story Tour of San Nicolas in Aruba
  '2455SEMI': { coord: { lng: -70.049, lat: 12.5748 }, source: 'known-place', place: 'Palm Beach', cite: 'OpenStreetMap way/23060047, verified 2026-08-03' },  // Aruba Semi-Submarine Cruise from Palm Beach
  '2455SUB': { coord: { lng: -70.0389, lat: 12.5189 }, source: 'known-place', place: 'Atlantis Submarines', cite: 'OpenStreetMap node/4509681292, verified 2026-08-03' },  // Aruba Atlantis Submarine Tour
  '12431P1': { coord: { lng: -70.0371, lat: 12.5201 }, source: 'known-place', place: 'Oranjestad', cite: 'OpenStreetMap node/50031810, verified 2026-08-03' },  // Half-Day Aruba Island Tour from Oranjestad
  '103088P3': { coord: { lng: -70.0519, lat: 12.6049 }, source: 'known-place', place: 'Boca Catalina', cite: 'OpenStreetMap way/690840582, verified 2026-08-03' },  // Adults Only Catalina Bay Small Group Snorkel & Sunset Sail
  '330511P1': { coord: { lng: -69.9852, lat: 12.559 }, source: 'known-place', place: 'Wariruri Bay', cite: 'OpenStreetMap relation/14759456, verified 2026-08-03' },  // Horseback Riding Wariruri Beach Tour in Aruba
  '337516P1': { coord: { lng: -69.9581, lat: 12.5408 }, source: 'known-place', place: 'Natural Bridge', cite: 'OpenStreetMap node/540233078, verified 2026-08-03' },  // 2-Hour Horseback Riding Tour to Little Natural Bridge in Aruba
  '2455P18': { coord: { lng: -69.9843, lat: 12.4696 }, source: 'known-place', place: 'De Palm Island', cite: 'OpenStreetMap: De Palm Island (water_park), verified 2026-08-03', offshore: true },  // Aruba De Palm Island Day Pass
  '5493518P1': { coord: { lng: -70.0594, lat: 12.5465 }, source: 'known-place', place: 'Eagle Beach', cite: 'OpenStreetMap way/25590792, verified 2026-08-03' },  // Aruba Eagle Beach Romantic Sunset Picnic in a Luxury Cabana
  '13526P9': { coord: { lng: -70.0536, lat: 12.6099 }, source: 'known-place', place: 'Arashi Beach', cite: 'OpenStreetMap way/461766965, verified 2026-08-03' },  // Action-Packed Half Day Aruba UTV Tour and Arashi Beach
  '7389P2': { coord: { lng: -70.0536, lat: 12.6099 }, source: 'known-place', place: 'Arashi Beach', cite: 'OpenStreetMap way/461766965, verified 2026-08-03' },  // Aruba Island Sightseeing Tour Plus Arashi Beach Visit
  '300281P4': { coord: { lng: -69.9485, lat: 12.4997 }, source: 'known-place', place: 'Arikok National Park', cite: 'OpenStreetMap node/6586531285, verified 2026-08-03' },  // Half Day Hike at Arikok National Park & Snorkel
  '324189P4': { coord: { lng: -69.9485, lat: 12.4997 }, source: 'known-place', place: 'Arikok National Park', cite: 'OpenStreetMap node/6586531285, verified 2026-08-03' },  // National Park Arikok Jeep Safari Adventures
  '250774P1': { coord: { lng: -69.9695, lat: 12.4643 }, source: 'known-place', place: 'Mangel Halto', cite: 'OpenStreetMap way/463354307, verified 2026-08-03' },  // Small-Group Sea Scooters Snorkel at Mangel Halto Beach in Arub
  '186518P5': { coord: { lng: -69.9695, lat: 12.4643 }, source: 'known-place', place: 'Mangel Halto', cite: 'OpenStreetMap way/463354307, verified 2026-08-03' },  // Small Group Snorkeling at Mangel Halto Aruba
  '122173P1': { coord: { lng: -69.9695, lat: 12.4643 }, source: 'known-place', place: 'Mangel Halto', cite: 'OpenStreetMap way/463354307, verified 2026-08-03' },  // Kayak Tour at Mangel Halto and Spanish Lagoon
  '445910P2': { coord: { lng: -70.0577, lat: 12.6021 }, source: 'known-place', place: 'SS Antilla wreck', cite: 'OpenStreetMap way/337807284, verified 2026-08-03', offshore: true },  // Aruba Sail and Snorkel with Turtles at WW2 Shipwreck Includes 
  '445910P1': { coord: { lng: -70.0577, lat: 12.6021 }, source: 'known-place', place: 'SS Antilla wreck', cite: 'OpenStreetMap way/337807284, verified 2026-08-03', offshore: true },  // Snorkel with Turtles at WW2 Shipwreck Includes Sunset & BBQ
  '13526P5': { coord: { lng: -70.0577, lat: 12.6021 }, source: 'known-place', place: 'SS Antilla wreck', cite: 'OpenStreetMap way/337807284, verified 2026-08-03', offshore: true },  // Antilla Shipwreck Seabob Tour
  '367744P2': { coord: { lng: -69.8793, lat: 12.4137 }, source: 'known-place', place: 'Baby Beach', cite: 'OpenStreetMap node/10308886317, verified 2026-08-03' },  // Full-Day Aruba Sightseeing island Tour with Baby Beach Swim
  '441143P2': { coord: { lng: -69.8793, lat: 12.4137 }, source: 'known-place', place: 'Baby Beach', cite: 'OpenStreetMap node/10308886317, verified 2026-08-03' },  // Aruba Half-Day Full Island Safari Adventure with Baby Beach Sw
  '153287P4': { coord: { lng: -69.8793, lat: 12.4137 }, source: 'known-place', place: 'Baby Beach', cite: 'OpenStreetMap node/10308886317, verified 2026-08-03' },  // Baby Beach Day Roundtrip
  '12431P9': { coord: { lng: -69.8793, lat: 12.4137 }, source: 'known-place', place: 'Baby Beach', cite: 'OpenStreetMap node/10308886317, verified 2026-08-03' },  // Aruba Baby Beach Express Tour
  '200215P3': { coord: { lng: -69.9287, lat: 12.5246 }, source: 'known-place', place: 'Conchi (Natural Pool)', cite: 'Wikipedia: Natural Pool (Aruba); matches the verified curated pin' },  // Horseback Riding and Natural Pool Adventure in Aruba
  '47774P4': { coord: { lng: -69.9287, lat: 12.5246 }, source: 'known-place', place: 'Conchi (Natural Pool)', cite: 'Wikipedia: Natural Pool (Aruba); matches the verified curated pin' },  // Aruba Natural Pools Northshore Safari Tour
  '6841P7': { coord: { lng: -69.9287, lat: 12.5246 }, source: 'known-place', place: 'Conchi (Natural Pool)', cite: 'Wikipedia: Natural Pool (Aruba); matches the verified curated pin' },  // Aruba UTV Adventure to Natural Pool Jeep Transfer
  '6841POOL': { coord: { lng: -69.9287, lat: 12.5246 }, source: 'known-place', place: 'Conchi (Natural Pool)', cite: 'Wikipedia: Natural Pool (Aruba); matches the verified curated pin' },  // Aruba Natural Pool and Indian Cave Rugged Jeep Safari
  '299932P2': { coord: { lng: -69.9287, lat: 12.5246 }, source: 'known-place', place: 'Conchi (Natural Pool)', cite: 'Wikipedia: Natural Pool (Aruba); matches the verified curated pin' },  // Sunrise Hike & Swim in Natural Pool: Escape the Crowds and Hea
  '446074P1': { coord: { lng: -69.9287, lat: 12.5246 }, source: 'known-place', place: 'Conchi (Natural Pool)', cite: 'Wikipedia: Natural Pool (Aruba); matches the verified curated pin' },  // Private Aruba National Park Hiking & Natural Pool Swimming
  '2455NPJEEP': { coord: { lng: -69.9287, lat: 12.5246 }, source: 'known-place', place: 'Conchi (Natural Pool)', cite: 'Wikipedia: Natural Pool (Aruba); matches the verified curated pin' },  // Aruba Off Road Safari Tour to Natural Pool
  '6593P16': { coord: { lng: -69.9287, lat: 12.5246 }, source: 'known-place', place: 'Conchi (Natural Pool)', cite: 'Wikipedia: Natural Pool (Aruba); matches the verified curated pin' },  // Aruba Natural Wonders Caves and Natural Pool Jeep Tour
  // ── Viator catalog items ────────────────────────────────────────────────────
  // Resolved by tools/resolve-coords.ts, reviewed one by one in the interactive
  // reviewer, and written from the saved decisions — coordinates copied, never
  // retyped. Items absent from this list were reviewed and declined, or have no
  // determinable location; either way they draw no pin.
  '37387P4': { coord: { lng: -70.0447, lat: 12.5776 }, source: 'known-place', place: 'MooMba Beach', cite: 'OpenStreetMap node/3809023231 (MooMba Beach bar). Jolly Pirates departure point confirmed by the product owner, 2026-08-03' },  // Jolly Pirate Sunset Grub and Grog Dinner Sail in Aruba
  '37387P3': { coord: { lng: -70.0447, lat: 12.5776 }, source: 'known-place', place: 'MooMba Beach', cite: 'OpenStreetMap node/3809023231 (MooMba Beach bar). Jolly Pirates departure point confirmed by the product owner, 2026-08-03' },  // Aruba Jolly Pirate Afternoon Sail with Snorkeling
  '37387P2': { coord: { lng: -70.0447, lat: 12.5776 }, source: 'known-place', place: 'MooMba Beach', cite: 'OpenStreetMap node/3809023231 (MooMba Beach bar). Jolly Pirates departure point confirmed by the product owner, 2026-08-03' },  // Aruba Sunset Jolly Pirate Sail with Open Bar
  '5566924P9': { coord: { lng: -70.0298, lat: 12.501 }, source: 'known-place', place: 'Flamingo Beach, Renaissance Island', cite: 'OpenStreetMap way/38424483, verified 2026-08-03' },  // Aruba 6 Hours Private Island Tour
  '62666P1': { coord: { lng: -70.0371, lat: 12.5201 }, source: 'known-place', place: 'Oranjestad', cite: 'OpenStreetMap node/50031810, verified 2026-08-03' },  // Aruba Downtown Historic and Cultural Walking Tour
  '117113P1': { coord: { lng: -69.909, lat: 12.4364 }, source: 'known-place', place: 'San Nicolas', cite: 'OpenStreetMap node/13111662192, verified 2026-08-03' },  // The Whole Story Tour with A Ride
  '6687P4': { coord: { lng: -70.0109, lat: 12.576 }, source: 'known-place', place: 'Alto Vista Chapel', cite: 'OpenStreetMap node/540115823, verified 2026-08-03' },  // Highlights of Aruba Island Tour
  '200215P2': { coord: { lng: -69.9766, lat: 12.5537 }, source: 'known-place', place: 'Bushiribana Gold Mill Ruins', cite: 'OpenStreetMap way/79210010, verified 2026-08-03' },  // Aruba North Coastline: Small-Group Horseback Riding Tour
  '2785SUNSET': { coord: { lng: -70.049, lat: 12.5748 }, source: 'known-place', place: 'Palm Beach', cite: 'OpenStreetMap way/23060047, verified 2026-08-03' },  // Aruba Sunset Catamaran Sail with Appetizers and Open Bar
  '7470P2': { coord: { lng: -69.9766, lat: 12.5537 }, source: 'known-place', place: 'Bushiribana Gold Mill Ruins', cite: 'OpenStreetMap way/79210010, verified 2026-08-03' },  // Aruba UTV Adventure
  '19808P11': { coord: { lng: -69.9485, lat: 12.4997 }, source: 'known-place', place: 'Arikok National Park', cite: 'OpenStreetMap node/6586531285, verified 2026-08-03' },  // UTV and Jeep Island Adventure Mix Up
  '5585429P2': { coord: { lng: -69.8793, lat: 12.4137 }, source: 'known-place', place: 'Baby Beach', cite: 'OpenStreetMap node/10308886317, verified 2026-08-03', stops: [{ coord: { lng: -69.9485, lat: 12.4997 }, place: 'Arikok National Park', cite: 'OpenStreetMap node/6586531285, verified 2026-08-03' }] },  // Aruba Island Private Jeep Tour Arikok Park & Baby beach
  '441143P5': { coord: { lng: -69.9287, lat: 12.5246 }, source: 'known-place', place: 'Conchi (Natural Pool)', cite: 'Wikipedia: Natural Pool (Aruba); matches the verified curated pin', stops: [{ coord: { lng: -69.8793, lat: 12.4137 }, place: 'Baby Beach', cite: 'OpenStreetMap node/10308886317, verified 2026-08-03' }] },  // Private 4x4 Natural Pool, Caves & Baby Beach by Cross Aruba To
  '324189P3': { coord: { lng: -69.909, lat: 12.4364 }, source: 'known-place', place: 'San Nicolas', cite: 'OpenStreetMap node/13111662192, verified 2026-08-03', stops: [{ coord: { lng: -69.8793, lat: 12.4137 }, place: 'Baby Beach', cite: 'OpenStreetMap node/10308886317, verified 2026-08-03' }] },  // Baby Beach and San Nicolas Art Murals Private EZ Raider Advent
  '358826P1': { coord: { lng: -69.9287, lat: 12.5246 }, source: 'known-place', place: 'Conchi (Natural Pool)', cite: 'Wikipedia: Natural Pool (Aruba); matches the verified curated pin', stops: [{ coord: { lng: -69.8793, lat: 12.4137 }, place: 'Baby Beach', cite: 'OpenStreetMap node/10308886317, verified 2026-08-03' }] },  // PRIVATE Jeep Safari Natural Pool, Indian Caves & Baby Beach wi
  '324189P1': { coord: { lng: -69.9766, lat: 12.5537 }, source: 'known-place', place: 'Bushiribana Gold Mill Ruins', cite: 'OpenStreetMap way/79210010, verified 2026-08-03', stops: [{ coord: { lng: -69.9581, lat: 12.5408 }, place: 'Natural Bridge', cite: 'OpenStreetMap node/540233078, verified 2026-08-03' }] },  // Aruba EZ Raider North Coast Ultimate Adventure
  '137607P20': { coord: { lng: -69.9287, lat: 12.5246 }, source: 'known-place', place: 'Conchi (Natural Pool)', cite: 'Wikipedia: Natural Pool (Aruba); matches the verified curated pin', stops: [{ coord: { lng: -69.9485, lat: 12.4997 }, place: 'Arikok National Park', cite: 'OpenStreetMap node/6586531285, verified 2026-08-03' }] },  // Aruba Private Open-Air Safari Jeep Tour + Arikok and Conchi Po
  '476164P1': { coord: { lng: -70.0536, lat: 12.6099 }, source: 'known-place', place: 'Arashi Beach', cite: 'OpenStreetMap way/461766965, verified 2026-08-03', stops: [{ coord: { lng: -70.0109, lat: 12.576 }, place: 'Alto Vista Chapel', cite: 'OpenStreetMap node/540115823, verified 2026-08-03' }] },  // Guided Electric Scooter Island Tour in Aruba (1 or 2-seater)
  '324189P2': { coord: { lng: -69.9485, lat: 12.4997 }, source: 'known-place', place: 'Arikok National Park', cite: 'OpenStreetMap node/6586531285, verified 2026-08-03', stops: [{ coord: { lng: -69.8793, lat: 12.4137 }, place: 'Baby Beach', cite: 'OpenStreetMap node/10308886317, verified 2026-08-03' }] },  // Private Jeep Tour National Park
  '441143P1': { coord: { lng: -69.9485, lat: 12.4997 }, source: 'known-place', place: 'Arikok National Park', cite: 'OpenStreetMap node/6586531285, verified 2026-08-03', stops: [{ coord: { lng: -69.9287, lat: 12.5246 }, place: 'Conchi (Natural Pool)', cite: 'Wikipedia: Natural Pool (Aruba); matches the verified curated pin' }, { coord: { lng: -69.8793, lat: 12.4137 }, place: 'Baby Beach', cite: 'OpenStreetMap node/10308886317, verified 2026-08-03' }] },  // Aruba Arikok National Park Jeep Safari: Natural Pool & Baby Be
  '441143P8': { coord: { lng: -69.9581, lat: 12.5408 }, source: 'known-place', place: 'Natural Bridge', cite: 'OpenStreetMap node/540233078, verified 2026-08-03', stops: [{ coord: { lng: -69.9287, lat: 12.5246 }, place: 'Conchi (Natural Pool)', cite: 'Wikipedia: Natural Pool (Aruba); matches the verified curated pin' }] },  // Aruba Natural Pool Jeep Adventure – Natural Bridge & Casibari
  '14261P1': { coord: { lng: -69.9485, lat: 12.4997 }, source: 'known-place', place: 'Arikok National Park', cite: 'OpenStreetMap node/6586531285, verified 2026-08-03', stops: [{ coord: { lng: -69.9287, lat: 12.5246 }, place: 'Conchi (Natural Pool)', cite: 'Wikipedia: Natural Pool (Aruba); matches the verified curated pin' }] },  // Horseback Ride Tour to Natural Pool in Arikok National Park
  '137607P17': { coord: { lng: -69.9287, lat: 12.5246 }, source: 'known-place', place: 'Conchi (Natural Pool)', cite: 'Wikipedia: Natural Pool (Aruba); matches the verified curated pin', stops: [{ coord: { lng: -69.9485, lat: 12.4997 }, place: 'Arikok National Park', cite: 'OpenStreetMap node/6586531285, verified 2026-08-03' }] },  // Aruba Outback Safari Jeep Tour - Lighthouse, Arikok & Conchi P
  '6593P8': { coord: { lng: -70.0577, lat: 12.6021 }, source: 'known-place', place: 'SS Antilla wreck', cite: 'OpenStreetMap way/337807284, verified 2026-08-03', offshore: true, stops: [{ coord: { lng: -70.0519, lat: 12.6049 }, place: 'Boca Catalina', cite: 'OpenStreetMap way/690840582, verified 2026-08-03' }] },  // Iconic Aruba Sail and Snorkel Experience
  '2785MORSNORKEL': { coord: { lng: -70.0577, lat: 12.6021 }, source: 'known-place', place: 'SS Antilla wreck', cite: 'OpenStreetMap way/337807284, verified 2026-08-03', offshore: true, stops: [{ coord: { lng: -70.0519, lat: 12.6049 }, place: 'Boca Catalina', cite: 'OpenStreetMap way/690840582, verified 2026-08-03' }] },  // Half-Day Snorkel Sail Tour with Caribbean Lunch
  '39473P4': { coord: { lng: -69.9287, lat: 12.5246 }, source: 'known-place', place: 'Conchi (Natural Pool)', cite: 'Wikipedia: Natural Pool (Aruba); matches the verified curated pin', stops: [{ coord: { lng: -69.8793, lat: 12.4137 }, place: 'Baby Beach', cite: 'OpenStreetMap node/10308886317, verified 2026-08-03' }] },  // Aruba Jeep Tour: Natural Pool, Caves and Baby Beach Adventure
  '186518P3': { coord: { lng: -69.9695, lat: 12.4643 }, source: 'known-place', place: 'Mangel Halto', cite: 'OpenStreetMap way/463354307, verified 2026-08-03', stops: [{ coord: { lng: -69.8793, lat: 12.4137 }, place: 'Baby Beach', cite: 'OpenStreetMap node/10308886317, verified 2026-08-03' }] },  // Aruba Snorkeling Tour: Mangel Halto and Baby Beach
  '2785AFTSNORKEL': { coord: { lng: -70.0577, lat: 12.6021 }, source: 'known-place', place: 'SS Antilla wreck', cite: 'OpenStreetMap way/337807284, verified 2026-08-03', offshore: true, stops: [{ coord: { lng: -70.0519, lat: 12.6049 }, place: 'Boca Catalina', cite: 'OpenStreetMap way/690840582, verified 2026-08-03' }] },  // Antilla Shipwreck and Catalina Bay Snorkel Sail
  '7389P8': { coord: { lng: -69.9695, lat: 12.4643 }, source: 'known-place', place: 'Mangel Halto', cite: 'OpenStreetMap way/463354307, verified 2026-08-03', stops: [{ coord: { lng: -69.8793, lat: 12.4137 }, place: 'Baby Beach', cite: 'OpenStreetMap node/10308886317, verified 2026-08-03' }] },  // Aruba Mangel Halto and Baby Beach Snorkeling Guided Tour
  '6841ISLAND': { coord: { lng: -69.9287, lat: 12.5246 }, source: 'known-place', place: 'Conchi (Natural Pool)', cite: 'Wikipedia: Natural Pool (Aruba); matches the verified curated pin', stops: [{ coord: { lng: -69.8793, lat: 12.4137 }, place: 'Baby Beach', cite: 'OpenStreetMap node/10308886317, verified 2026-08-03' }] },  // Island Jeep Safari with Natural Pool Baby Beach and Lunch
  '19808P9': { coord: { lng: -69.9287, lat: 12.5246 }, source: 'known-place', place: 'Conchi (Natural Pool)', cite: 'Wikipedia: Natural Pool (Aruba); matches the verified curated pin', stops: [{ coord: { lng: -69.8793, lat: 12.4137 }, place: 'Baby Beach', cite: 'OpenStreetMap node/10308886317, verified 2026-08-03' }] },  // Aruba Signature Jeep Tour: Natural Pool and Baby Beach
  '186518P1': { coord: { lng: -69.9695, lat: 12.4643 }, source: 'known-place', place: 'Mangel Halto', cite: 'OpenStreetMap way/463354307, verified 2026-08-03' },  // Shore Dive Aruba for Certified Divers
  '2455HAPPY': { coord: { lng: -70.0577, lat: 12.6021 }, source: 'known-place', place: 'SS Antilla wreck', cite: 'OpenStreetMap way/337807284, verified 2026-08-03', offshore: true },  // Aruba Afternoon Snorkel Sail aboard Palm Pleasure Catamaran
  '119085P1': { coord: { lng: -70.0577, lat: 12.6021 }, source: 'known-place', place: 'SS Antilla wreck', cite: 'OpenStreetMap way/337807284, verified 2026-08-03', offshore: true },  // Dolphin Catamaran Snorkel and Sail with Open Bar
  // ── Viator catalog items ────────────────────────────────────────────────────
  // Resolved by tools/resolve-coords.ts, reviewed one by one in the interactive
  // reviewer, and written from the saved decisions — coordinates copied, never
  // retyped. Items absent from this list were reviewed and declined, or have no
  // determinable location; either way they draw no pin.
  '245508': { coord: { lng: -70.0487, lat: 12.5682 }, source: 'departure', place: 'De Palm Pier', cite: 'OpenStreetMap way/335257951 (De Palm Pier); Bugaloe sits on it — meeting point per Viator: "Walk down the walkway between the Hilton and RIU Palace. You will see the Coconuts Gift Shop on De Palm Pier. Enter the "' },  // Aruba Sunset Sail with Open Bar
  '103088P1': { coord: { lng: -70.049, lat: 12.5748 }, source: 'departure', place: 'Palm Beach', cite: 'OpenStreetMap way/23060047, verified 2026-08-03 — meeting point per Viator: "Palm Beach Pier SURF CLUB (Marriott)"' },  // VIP Morning Delight Champagne Sailing and Snorkeling with Lunc
  '6593P7': { coord: { lng: -70.0461, lat: 12.5744 }, source: 'departure', place: 'Pelican Pier', cite: 'OpenStreetMap way/555476889, verified 2026-08-03 — meeting point per Viator: "Pelican Pier is located between the Holiday Inn Hotel and the Playa Linda Beach Resort. Check-in time is at 9:30 A.M"' },  // Luxury Lagoon Cruise with Onboard Chef and Signature Cocktails
  '2785DINNER': { coord: { lng: -70.0461, lat: 12.5744 }, source: 'departure', place: 'Pelican Pier', cite: 'OpenStreetMap way/555476889, verified 2026-08-03 — meeting point per Viator: "Please check in at our pier located behind the Hyatt Regency 30 minutes prior to departure time"' },  // Aruba Sunset Sail Dinner Cruise with Open Bar by Catamaran
  '6593P11': { coord: { lng: -70.0461, lat: 12.5744 }, source: 'departure', place: 'Pelican Pier', cite: 'OpenStreetMap way/555476889, verified 2026-08-03 — meeting point per Viator: "Check in time is at 4:30pm at Pelican Pier which is between the Holiday Inn Hotel and Playa Linda Beach Resort."' },  // Luxury Four-Course Caribbean Dinner Cruise Experience
  '6593P10': { coord: { lng: -70.0461, lat: 12.5744 }, source: 'departure', place: 'Pelican Pier', cite: 'OpenStreetMap way/555476889, verified 2026-08-03 — meeting point per Viator: "Check-in time is at 5:00 P.M at the front desk of the Pelican Pier located between the Holiday Inn & Playa Linda Beach R"' },  // Aruba Sunset Sail Experience
  '47607P2': { coord: { lng: -70.0449, lat: 12.5759 }, source: 'departure', place: 'Holiday Inn Resort', cite: 'APPROX — pinned at the named hotel; the pier sits ~150-200m seaward. OpenStreetMap way/370372887, verified 2026-08-03 — meeting point per Viator: "Your tour departs from the Octopus Aruba beach hut which is located on Palm Beach behind the Holiday Inn. Once you reach"', approx: true },  // Premium Catamaran Afternoon Sail: Snorkeling and Lunch
  '2785P10': { coord: { lng: -70.0471, lat: 12.5717 }, source: 'departure', place: 'Piet\'s Pier', cite: 'OpenStreetMap way/613967713 (pier, unnamed, 163m west of the Hyatt Regency); identified as Piet\'s Pier by the product owner, 2026-08-03 — meeting point per Viator: "Please check in at our pier located behind the Hyatt Regency 30 min prior to departure."' },  // Aruba Sunset Sail with Caribbean Dinner and Live Music
  '47607P3': { coord: { lng: -70.0449, lat: 12.5759 }, source: 'departure', place: 'Holiday Inn Resort', cite: 'APPROX — pinned at the named hotel; the pier sits ~150-200m seaward. OpenStreetMap way/370372887, verified 2026-08-03 — meeting point per Viator: "Your tour departs from the Octopus Aruba beach hut which is located on Palm Beach behind the Holiday Inn. Once you reach"', approx: true },  // Premium Catamaran Morning Sail: Snorkeling, Mimosas and Brunch
  '6593DINNER': { coord: { lng: -70.0461, lat: 12.5744 }, source: 'departure', place: 'Pelican Pier', cite: 'OpenStreetMap way/555476889, verified 2026-08-03 — meeting point per Viator: "Check-in time is at 5:00 P.M. at the Pelican Pier, located between Playa Linda Beach Resort and the Holiday Inn."' },  // Aruba Sunset Cruise plus Seaside Dinner
  '13526P13': { coord: { lng: -70.0447, lat: 12.5776 }, source: 'departure', place: 'MooMba Beach', cite: 'OpenStreetMap node/3809023231 (MooMba Beach bar). Jolly Pirates departure point confirmed by the product owner, 2026-08-03 — meeting point per Viator: "Hadicurari Fishermans Pier/Moomba Beach Bar is located on the beach between Marriott Surf Club and Holiday Inn. Our repr"' },  // Banana Adventure Catamaran Shipwreck Snorkel and Turtle Swim
  '13526P14': { coord: { lng: -70.0449, lat: 12.5759 }, source: 'departure', place: 'Holiday Inn Resort', cite: 'APPROX — pinned at the named hotel; the pier sits ~150-200m seaward. OpenStreetMap way/370372887, verified 2026-08-03 — meeting point per Viator: "Located between Holiday Inn and Marriott"', approx: true },  // Banana Adventure Catamaran Tropical Sunset Sail
  '6593BRUNCH': { coord: { lng: -70.0461, lat: 12.5744 }, source: 'departure', place: 'Pelican Pier', cite: 'OpenStreetMap way/555476889, verified 2026-08-03 — meeting point per Viator: "Check-in time is at 8:30AM at Pelican Pier which is between the Holiday Inn Hotel & Playa Linda Beach Resort."' },  // Premium Morning Snorkel Sail with Champagne Brunch
  '47607P4': { coord: { lng: -70.0449, lat: 12.5759 }, source: 'departure', place: 'Holiday Inn Resort', cite: 'APPROX — pinned at the named hotel; the pier sits ~150-200m seaward. OpenStreetMap way/370372887, verified 2026-08-03 — meeting point per Viator: "Your tour departs from the Octopus Aruba beach hut, located on Palm Beach behind the Holiday Inn. Please walk through th"', approx: true },  // Aruba Happy Hour Sunset Sail with Savory Bites and Cocktails
  '119085P10': { coord: { lng: -70.0456, lat: 12.5718 }, source: 'departure', place: 'Hyatt Regency Aruba Resort Spa and Casino', cite: 'APPROX — pinned at the named hotel; the pier sits ~150-200m seaward. OpenStreetMap way/629617326, verified 2026-08-03 — meeting point per Viator: "Delphi Watersports (big sign) is located in front of the Hyatt Regency towel hut on the beach. Ask for Olga and Jhon wea"', approx: true },  // Private Boat Cruise with Snorkeling
  '444239P8': { coord: { lng: -70.0136, lat: 12.4958 }, source: 'departure', place: 'Bucutiweg', cite: 'APPROX — pinned at the named hotel; the pier sits ~150-200m seaward. OpenStreetMap way/40957323 (tertiary), verified 2026-08-03 (street/area level — accurate to the block, not the doorway) — meeting point per Viator: "our address is Bucutiweg #34 or if using GPS, it is easier to locate The Fish House Restaurant at Varadero Marina as we "', approx: true },  // Tropical Sailing Experience with BBQ Lunch or BBQ Dinner in Ar
  '103020P7': { coord: { lng: -70.0136, lat: 12.4958 }, source: 'departure', place: 'Bucutiweg', cite: 'APPROX — pinned at the named hotel; the pier sits ~150-200m seaward. OpenStreetMap way/40957323 (tertiary), verified 2026-08-03 (street/area level — accurate to the block, not the doorway) — meeting point per Viator: "Behind the airport at address Bucutiweg 31."', approx: true },  // Luxury Private Yacht Charter Aruba - Eden Luca Yachts
  '119085P2': { coord: { lng: -70.0456, lat: 12.5718 }, source: 'departure', place: 'Hyatt Regency Aruba Resort Spa and Casino', cite: 'APPROX — pinned at the named hotel; the pier sits ~150-200m seaward. OpenStreetMap way/629617326, verified 2026-08-03 — meeting point per Viator: "Check in time is 30 minutes before the start time of the tour. Delphi Watersports is located in front of the Hyatt Regen"', approx: true },  // Aruba Sunset Sail Cruise Aboard The Dolphin Catamaran
  '392509P1': { coord: { lng: -69.972, lat: 12.5322 }, source: 'departure', place: 'Ayo Rock Formation', cite: 'OpenStreetMap way/43109643 (park), verified 2026-08-03 — meeting point per Viator: "Our meeting point is on the same road of the Ayo Rock Formation, just a (1) minute drive or 1/4 miles (400 m) further to"' },  // Epic Off-Road Surron Electric Bike Tour in Aruba
  '5593159P4': { coord: { lng: -70.0512, lat: 12.5642 }, source: 'departure', place: 'Divi Phoenix', cite: 'APPROX — pinned at the named hotel; the pier sits ~150-200m seaward. OpenStreetMap node/3102983952, verified 2026-08-03 — meeting point per Viator: "The Beach is located right behind of the Divi Phoenix Resort. The Divi Phoenix Resort is located next to the St. Regis R"', approx: true },  // 50%OFF Aruba‘s #1Clear Kayak Experience@arubaphotoshootexperie
  '476164P4': { coord: { lng: -70.0306, lat: 12.5461 }, source: 'departure', place: 'Tanki Flip', cite: 'APPROX — pinned at the named hotel; the pier sits ~150-200m seaward. OpenStreetMap overpass place=village (village), verified 2026-08-03 (street/area level — accurate to the block, not the doorway) — meeting point per Viator: "Next to Dunkin Donuts at the Tank Flip roundabout in Noord, Aruba"', approx: true },  // Guided 3-Hour E-Scooter Island Tour in Aruba (1 or 2-seater)
  '476164P3': { coord: { lng: -70.0306, lat: 12.5461 }, source: 'departure', place: 'Tanki Flip', cite: 'APPROX — pinned at the named hotel; the pier sits ~150-200m seaward. OpenStreetMap overpass place=village (village), verified 2026-08-03 (street/area level — accurate to the block, not the doorway) — meeting point per Viator: "Located at the Tanki Flip roundabout located in Noord, Aruba."', approx: true },  // Sunset Island Tour in Aruba on Electric Scooter (1 or 2-seater
  '325347P3': { coord: { lng: -70.0513, lat: 12.6024 }, source: 'departure', place: 'Tres Trapi', cite: 'OpenStreetMap node/4491605028, verified 2026-08-03 — meeting point per Viator: "Look for the snorkeling guides wearing a bright colored Underdog Divers longsleeve shirt. For GPS locations or direction"' },  // Private Turtle Snorkel Tour in Aruba +Professional video foota
  '325347P2': { coord: { lng: -69.9695, lat: 12.4643 }, source: 'departure', place: 'Mangel Halto', cite: 'OpenStreetMap way/463354307, verified 2026-08-03 — meeting point per Viator: "We wear bright colored long sleeved shirts with the Underdog Divers logo on it. So you can’t miss us. It’s easy to find,"' },  // Private First-Time Dive in Aruba. Reef, Wreck or Turtle site
};

/** Look up a pin. Returns undefined — never a fallback — for unregistered ids. */
export function pinFor(id: string): Pin | undefined {
  return ITEM_PINS[id];
}

/**
 * Every place a pin covers — the primary first, then any additional stops.
 *
 * The map draws one marker per entry. They must READ AS ONE ACTIVITY, not as
 * separate stops in the day: same stop number on every marker, a dashed tether
 * between them, secondary markers visually lighter than the primary, and any of
 * them opening the same card. A traveller should see "this one thing happens in
 * two places", never "I have two activities here".
 *
 * The day's route line and the engine both use the primary only — see `coord`.
 */
export function pinPlaces(pin: Pin): Array<{ coord: Coord; place?: string; cite: string; offshore?: true; primary: boolean }> {
  return [
    { coord: pin.coord, place: pin.place, cite: pin.cite, offshore: pin.offshore, primary: true },
    ...(pin.stops ?? []).map((s) => ({ ...s, primary: false as const })),
  ];
}

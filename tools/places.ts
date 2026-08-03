import type { Coord } from '../src/data/coords';

/**
 * Aruba place table — AUTHORING INPUT ONLY.
 *
 * Used by tools/resolve-coords.ts to propose pins from product titles. Never
 * imported by app code and never shipped: the registry (src/data/itemCoords.ts)
 * holds literal coordinates, so the browser needs no matching logic at all.
 *
 * Generated from an OpenStreetMap Overpass export of named Aruba features
 * (beaches, attractions, bays, caves, landmarks, marinas, towns), then curated by
 * hand. The raw export held 293 elements; most were noise for this purpose —
 * 102 residential neighbourhoods, 26 "Sero" hills, 21 Oranjestad monuments, and
 * the island "Aruba" itself, which would have matched every product title.
 *
 * Two traps found while curating, both left out:
 *   - OSM has a node named "Druif" at 12.6049 in the north, ~8km from the real
 *     Druif Beach at 12.5340. Only the beach feature is used here.
 *   - "California" (the wreck), "California Beach" and "California Lighthouse"
 *     are three distinct features. Longest-alias-wins in the resolver keeps
 *     "california lighthouse" from being swallowed by a shorter match.
 *
 * ALIAS RULES — read before adding an entry:
 *   - Never add a single generic word ("beach", "pier", "cave", "bay"). It will
 *     match half the catalog.
 *   - Aliases are matched on word boundaries, longest first.
 *   - If two entries could match the same title, the resolver reports AMBIGUOUS
 *     and proposes no pin. That is the intended outcome, not a bug to work around.
 */
export type Place = {
  id: string;
  name: string;
  aliases: string[];
  coord: Coord;
  terrain: 'land' | 'water';
  cite: string;
  /**
   * 'venue'    — a real departure point: a pier, marina or beach club.
   * 'landmark' — a hotel used only to locate a venue in prose.
   * undefined  — an ordinary destination (beach, park, cave, town).
   *
   * A venue always outranks a landmark when both appear in one meeting-point
   * description, because the hotel is how the text describes where the pier is,
   * not where the activity departs from.
   */
  role?: 'venue' | 'landmark';
};

export const PLACES: Place[] = [
  // Piet's Pier — the pier behind the Hyatt Regency. OSM has the pier geometry
  // but no name on it; the identification is the product owner's local knowledge
  // (2026-08-03). It sits 163m due west of the hotel, at the same latitude,
  // which is exactly what "our pier located behind the Hyatt Regency" describes.
  //
  // NOT Pelican Pier: Viator's own text puts that one "between the Holiday Inn
  // and the Playa Linda" (lat 12.5744, and OSM agrees), which is 293m north of
  // the Hyatt with the Playa Linda in between. Two different piers.
  //
  // The description phrases are aliases on purpose. They are not names, but on
  // this stretch of Palm Beach "behind the Hyatt" identifies exactly one pier,
  // and it is what the operators actually write. Every match is still reviewed.
  { id: 'piets-pier', role: 'venue', name: "Piet's Pier", terrain: 'land',
    coord: { lng: -70.0471, lat: 12.5717 },
    aliases: ["piet's pier", 'piets pier', 'pier behind the hyatt', 'behind the hyatt regency', 'behind the hyatt'],
    cite: "OpenStreetMap way/613967713 (pier, unnamed, 163m west of the Hyatt Regency); identified as Piet's Pier by the product owner, 2026-08-03" },
  // ── Hotel landmarks (role: 'landmark') ────────────────────────────────────
  // Viator meeting-point descriptions locate piers by the hotel beside them:
  // "our pier located behind the Hyatt Regency", "Pelican Pier is located
  // between the Holiday Inn Hotel and the Playa Linda Beach Resort".
  //
  // These are ORIENTATION anchors, not destinations. A named pier always beats a
  // hotel when both appear in the same description — see the resolver. A pin
  // placed on the hotel is an approximation of the pier on its beach, ~100-200m
  // away, and the citation says so.
  { id: 'amsterdam-manor-resort', name: 'Amsterdam Manor Resort', terrain: 'land', role: 'landmark',
    coord: { lng: -70.0544, lat: 12.5541 },
    aliases: ['amsterdam manor'],
    cite: 'OpenStreetMap way/640018902, verified 2026-08-03' },
  { id: 'aruba-marriott-resort', name: 'Aruba Marriott Resort', terrain: 'land', role: 'landmark',
    coord: { lng: -70.0435, lat: 12.5807 },
    aliases: ['aruba marriott', 'marriott resort'],
    cite: 'OpenStreetMap way/370141800, verified 2026-08-03' },
  { id: 'bucuti-and-tara-resort', name: 'Bucuti and Tara resort', terrain: 'land', role: 'landmark',
    coord: { lng: -70.0618, lat: 12.5417 },
    aliases: ['bucuti'],
    cite: 'OpenStreetMap way/370524102, verified 2026-08-03' },
  { id: 'costa-linda-beach-resort', name: 'Costa Linda Beach Resort', terrain: 'land', role: 'landmark',
    coord: { lng: -70.0612, lat: 12.5433 },
    aliases: ['costa linda'],
    cite: 'OpenStreetMap way/751959427, verified 2026-08-03' },
  { id: 'divi-dutch-village-beach-resort', name: 'Divi Dutch Village Beach Resort', terrain: 'land', role: 'landmark',
    coord: { lng: -70.0553, lat: 12.5321 },
    aliases: ['divi dutch village'],
    cite: 'OpenStreetMap way/1463835569, verified 2026-08-03' },
  { id: 'divi-phoenix', name: 'Divi Phoenix', terrain: 'land', role: 'landmark',
    coord: { lng: -70.0512, lat: 12.5642 },
    aliases: ['divi phoenix'],
    cite: 'OpenStreetMap node/3102983952, verified 2026-08-03' },
  { id: 'embassy-suites', name: 'Embassy Suites', terrain: 'land', role: 'landmark',
    coord: { lng: -70.0522, lat: 12.561 },
    aliases: ['embassy suites'],
    cite: 'OpenStreetMap node/6303599521, verified 2026-08-03' },
  { id: 'hilton', name: 'Hilton', terrain: 'land', role: 'landmark',
    coord: { lng: -70.0463, lat: 12.5683 },
    aliases: ['hilton'],
    cite: 'OpenStreetMap node/924094088, verified 2026-08-03' },
  { id: 'hotel-riu-palace-antillas', name: 'Hotel Riu Palace Antillas', terrain: 'land', role: 'landmark',
    coord: { lng: -70.0483, lat: 12.5658 },
    aliases: ['riu palace antillas'],
    cite: 'OpenStreetMap way/38528332, verified 2026-08-03' },
  { id: 'hotel-riu-palace-aruba', name: 'Hotel Riu Palace Aruba', terrain: 'land', role: 'landmark',
    coord: { lng: -70.0478, lat: 12.567 },
    aliases: ['riu palace aruba', 'riu palace'],
    cite: 'OpenStreetMap way/370376059, verified 2026-08-03' },
  { id: 'hyatt-regency-aruba-resort-spa-and', name: 'Hyatt Regency Aruba Resort Spa and Casino', terrain: 'land', role: 'landmark',
    coord: { lng: -70.0456, lat: 12.5718 },
    aliases: ['hyatt regency', 'hyatt'],
    cite: 'OpenStreetMap way/629617326, verified 2026-08-03' },
  { id: 'la-cabana-beach-resort-and-casino', name: 'La Cabana Beach Resort & Casino', terrain: 'land', role: 'landmark',
    coord: { lng: -70.0541, lat: 12.5516 },
    aliases: ['la cabana'],
    cite: 'OpenStreetMap way/335599680, verified 2026-08-03' },
  { id: 'manchebo-beach-resort-and-spa', name: 'Manchebo Beach Resort & Spa', terrain: 'land', role: 'landmark',
    coord: { lng: -70.0623, lat: 12.5408 },
    aliases: ['manchebo beach resort'],
    cite: 'OpenStreetMap way/335599676, verified 2026-08-03' },
  { id: 'marriott-ocean-club', name: 'Marriott Ocean Club', terrain: 'land', role: 'landmark',
    coord: { lng: -70.0433, lat: 12.5794 },
    aliases: ['marriott ocean club'],
    cite: 'OpenStreetMap way/321552376, verified 2026-08-03' },
  { id: 'playa-linda-beach-resort', name: 'Playa Linda Beach Resort', terrain: 'land', role: 'landmark',
    coord: { lng: -70.0451, lat: 12.5733 },
    aliases: ['playa linda'],
    cite: 'OpenStreetMap node/3102989929, verified 2026-08-03' },
  { id: 'radisson-blu', name: 'Radisson Blu', terrain: 'land', role: 'landmark',
    coord: { lng: -70.0421, lat: 12.5757 },
    aliases: ['radisson'],
    cite: 'OpenStreetMap way/370371692, verified 2026-08-03' },
  { id: 'royal-level-at-barceló-aruba', name: 'Royal Level at Barceló Aruba', terrain: 'land', role: 'landmark',
    coord: { lng: -70.0458, lat: 12.5704 },
    aliases: ['barcelo', 'barceló'],
    cite: 'OpenStreetMap node/924108491, verified 2026-08-03' },
  { id: 'tamarijn-divi-aruba', name: 'Tamarijn Divi Aruba', terrain: 'land', role: 'landmark',
    coord: { lng: -70.0558, lat: 12.5355 },
    aliases: ['tamarijn'],
    cite: 'OpenStreetMap node/2067021475, verified 2026-08-03' },
  { id: 'the-ritz-carlton-aruba', name: 'The Ritz-Carlton, Aruba', terrain: 'land', role: 'landmark',
    coord: { lng: -70.0441, lat: 12.5829 },
    aliases: ['ritz-carlton', 'ritz carlton'],
    cite: 'OpenStreetMap way/370096811, verified 2026-08-03' },
  { id: 'holiday-inn-resort', name: 'Holiday Inn Resort', terrain: 'land', role: 'landmark',
    coord: { lng: -70.0449, lat: 12.5759 },
    aliases: ['holiday inn'],
    cite: 'OpenStreetMap way/370372887, verified 2026-08-03' },
  // ── Departure venues ──────────────────────────────────────────────────────
  // Piers and beach clubs that sails, cruises and watersports actually leave
  // from. Added because Viator cannot supply a departure point: its product
  // `logistics.start[]` refs resolve to Google Place IDs carrying no name and no
  // coordinates, and the product pages return 403 to any fetch. These make the
  // reviewer's departure dropdown usable, so a human assigns them per product.
  { id: 'moomba-beach', role: 'venue', name: 'MooMba Beach', terrain: 'land',
    coord: { lng: -70.0447, lat: 12.5776 },
    aliases: ['moomba', 'moomba beach', 'jolly pirate', 'jolly pirates'],
    cite: 'OpenStreetMap node/3809023231 (MooMba Beach bar). Jolly Pirates departure point confirmed by the product owner, 2026-08-03' },
  { id: 'de-palm-pier', role: 'venue', name: 'De Palm Pier', terrain: 'land',
    coord: { lng: -70.0487, lat: 12.5682 },
    aliases: ['de palm pier', 'bugaloe'],
    cite: 'OpenStreetMap way/335257951 (De Palm Pier); Bugaloe sits on it' },
  { id: 'pelican-pier', role: 'venue', name: 'Pelican Pier', terrain: 'land',
    coord: { lng: -70.0461, lat: 12.5744 },
    aliases: ['pelican pier', 'pelican adventures'],
    cite: 'OpenStreetMap way/555476889, verified 2026-08-03' },
  { id: 'hadicurari-pier', role: 'venue', name: 'Hadicurari Pier', terrain: 'land',
    coord: { lng: -70.0455, lat: 12.5780 },
    aliases: ['hadicurari pier'],
    cite: 'OpenStreetMap way/371842506, verified 2026-08-03' },
  { id: 'pier-di-rancho', role: 'venue', name: 'Pier Di Rancho, Oranjestad', terrain: 'land',
    coord: { lng: -70.0401, lat: 12.5192 },
    aliases: ['pier di rancho', 'rancho pier'],
    cite: 'OpenStreetMap way/367742288, verified 2026-08-03' },
  { id: 'de-palm-ferry', role: 'venue', name: 'De Palm Island Ferry Terminal', terrain: 'land',
    coord: { lng: -69.9787, lat: 12.4723 },
    aliases: ['de palm island ferry'],
    cite: 'OpenStreetMap node/2682381431, verified 2026-08-03' },
  { id: 'barefoot', role: 'venue', name: 'Barefoot Restaurant, Oranjestad', terrain: 'land',
    coord: { lng: -70.0294, lat: 12.5085 },
    aliases: ['barefoot restaurant'],
    cite: 'OpenStreetMap node/1814558239, verified 2026-08-03' },
  { id: 'west-deck', role: 'venue', name: 'The West Deck, Oranjestad', terrain: 'land',
    coord: { lng: -70.0346, lat: 12.5154 },
    aliases: ['west deck'],
    cite: 'OpenStreetMap node/4256309544, verified 2026-08-03' },
  { id: 'pelican-watersports', role: 'venue', name: 'Pelican Tours & Watersports', terrain: 'land',
    coord: { lng: -70.0570, lat: 12.5445 },
    aliases: ['pelican tours', 'pelican watersports'],
    cite: 'OpenStreetMap way/370524409, verified 2026-08-03' },
  // NOT in the Overpass export — the Conchi rock pool carries no queryable OSM
  // feature under either name. Coordinate is the Wikipedia one already verified in
  // src/data/itemCoords.ts ('natural-pool-jeep'). 7 plannable catalog titles say
  // "natural pool" and matched nothing before this was added.
  { id: 'natural-pool', name: 'Conchi (Natural Pool)', terrain: 'land',
    coord: { lng: -69.9287, lat: 12.5246 },
    aliases: ['natural pool', 'natural pools', 'conchi'],
    cite: 'Wikipedia: Natural Pool (Aruba); matches the verified curated pin' },
  { id: 'de-palm-island', name: 'De Palm Island', terrain: 'land',
    coord: { lng: -69.9843, lat: 12.4696 },
    aliases: ['de palm island'],
    cite: 'OpenStreetMap: De Palm Island (water_park), verified 2026-08-03' },
  { id: 'alto-vista', name: 'Alto Vista Chapel', terrain: 'land',
    coord: { lng: -70.0109, lat: 12.576 },
    aliases: ['alto vista'],
    cite: 'OpenStreetMap node/540115823, verified 2026-08-03' },
  { id: 'andicuri', name: 'Andicuri Beach', terrain: 'land',
    coord: { lng: -69.9558, lat: 12.5375 },
    aliases: ['andicuri'],
    cite: 'OpenStreetMap way/339090140, verified 2026-08-03' },
  // "WW2/WWII shipwreck" is unambiguous on Aruba — the Antilla is the wreck every
  // snorkel-with-turtles product means. Added after 2 catalog titles used only
  // that phrasing and matched nothing.
  { id: 'antilla', name: 'SS Antilla wreck', terrain: 'water',
    coord: { lng: -70.0577, lat: 12.6021 },
    aliases: ['antilla', 'ss antilla', 'antilla wreck', 'antilla shipwreck', 'ww2 shipwreck', 'wwii shipwreck', 'ww2 wreck', 'wwii wreck'],
    cite: 'OpenStreetMap way/337807284, verified 2026-08-03' },
  { id: 'arashi', name: 'Arashi Beach', terrain: 'land',
    coord: { lng: -70.0536, lat: 12.6099 },
    aliases: ['arashi', 'arashi beach'],
    cite: 'OpenStreetMap way/461766965, verified 2026-08-03' },
  { id: 'arikok', name: 'Arikok National Park', terrain: 'land',
    coord: { lng: -69.9485, lat: 12.4997 },
    aliases: ['arikok', 'national park arikok', 'arikok national park'],
    cite: 'OpenStreetMap node/6586531285, verified 2026-08-03' },
  { id: 'atlantis-sub', name: 'Atlantis Submarines', terrain: 'land',
    coord: { lng: -70.0389, lat: 12.5189 },
    aliases: ['atlantis submarine', 'atlantis submarines'],
    cite: 'OpenStreetMap node/4509681292, verified 2026-08-03' },
  { id: 'baby-beach', name: 'Baby Beach', terrain: 'land',
    coord: { lng: -69.8793, lat: 12.4137 },
    aliases: ['baby beach'],
    cite: 'OpenStreetMap node/10308886317, verified 2026-08-03' },
  { id: 'bachelors-beach', name: 'Bachelor’s Beach', terrain: 'land',
    coord: { lng: -69.8717, lat: 12.4322 },
    aliases: ['bachelor’s beach', 'bachelors beach'],
    cite: 'OpenStreetMap way/255369699, verified 2026-08-03' },
  { id: 'boca-catalina', name: 'Boca Catalina', terrain: 'land',
    coord: { lng: -70.0519, lat: 12.6049 },
    aliases: ['boca catalina', 'catalina bay'],
    cite: 'OpenStreetMap way/690840582, verified 2026-08-03' },
  { id: 'boca-grandi', name: 'Boca Grandi', terrain: 'land',
    coord: { lng: -69.8744, lat: 12.4415 },
    aliases: ['boca grandi'],
    cite: 'OpenStreetMap relation/1406785, verified 2026-08-03' },
  { id: 'boca-keto', name: 'Boca Keto', terrain: 'land',
    coord: { lng: -69.9332, lat: 12.5278 },
    aliases: ['boca keto'],
    cite: 'OpenStreetMap node/7452929046, verified 2026-08-03' },
  { id: 'boca-prins', name: 'Boca Prins', terrain: 'land',
    coord: { lng: -69.9076, lat: 12.4978 },
    aliases: ['boca prins'],
    cite: 'OpenStreetMap node/1773562158, verified 2026-08-03' },
  { id: 'bushiribana', name: 'Bushiribana Gold Mill Ruins', terrain: 'land',
    coord: { lng: -69.9766, lat: 12.5537 },
    aliases: ['bushiribana', 'gold mill ruins', 'gold smelter'],
    cite: 'OpenStreetMap way/79210010, verified 2026-08-03' },
  { id: 'butterfly-farm', name: 'The Butterfly Farm', terrain: 'land',
    coord: { lng: -70.05, lat: 12.5637 },
    aliases: ['butterfly farm'],
    cite: 'OpenStreetMap way/38451837, verified 2026-08-03' },
  { id: 'california-lighthouse', name: 'California Lighthouse', terrain: 'land',
    coord: { lng: -70.0513, lat: 12.6138 },
    aliases: ['california lighthouse'],
    cite: 'OpenStreetMap node/540121391, verified 2026-08-03' },
  { id: 'daimari', name: 'Daimari', terrain: 'land',
    coord: { lng: -69.9388, lat: 12.531 },
    aliases: ['daimari'],
    cite: 'OpenStreetMap relation/14756250, verified 2026-08-03' },
  { id: 'dos-playa', name: 'Dos Playa', terrain: 'land',
    coord: { lng: -69.918, lat: 12.5049 },
    aliases: ['dos playa'],
    cite: 'OpenStreetMap node/5930475305, verified 2026-08-03' },
  { id: 'druif-beach', name: 'Druif Beach', terrain: 'land',
    coord: { lng: -70.0574, lat: 12.5339 },
    aliases: ['druif', 'druif beach'],
    cite: 'OpenStreetMap way/261454624, verified 2026-08-03' },
  { id: 'eagle-beach', name: 'Eagle Beach', terrain: 'land',
    coord: { lng: -70.0594, lat: 12.5465 },
    aliases: ['eagle beach'],
    cite: 'OpenStreetMap way/25590792, verified 2026-08-03' },
  { id: 'flamingo-beach', name: 'Flamingo Beach, Renaissance Island', terrain: 'land',
    coord: { lng: -70.0298, lat: 12.501 },
    aliases: ['flamingo beach', 'renaissance island', 'private island'],
    cite: 'OpenStreetMap way/38424483, verified 2026-08-03' },
  { id: 'fontein-cave', name: 'Fontein Cave', terrain: 'land',
    coord: { lng: -69.9073, lat: 12.4929 },
    aliases: ['fontein cave'],
    cite: 'OpenStreetMap node/540167863, verified 2026-08-03' },
  { id: 'fort-zoutman', name: 'Fort Zoutman', terrain: 'land',
    coord: { lng: -70.0356, lat: 12.5177 },
    aliases: ['fort zoutman'],
    cite: 'OpenStreetMap way/769698096, verified 2026-08-03' },
  { id: 'grapefield', name: 'Grapefield Beach', terrain: 'land',
    coord: { lng: -69.8786, lat: 12.4538 },
    aliases: ['grapefield'],
    cite: 'OpenStreetMap way/495510386, verified 2026-08-03' },
  { id: 'guadirikiri', name: 'Guadirikiri Cave', terrain: 'land',
    coord: { lng: -69.8995, lat: 12.4825 },
    aliases: ['guadirikiri', 'guadirikiri cave'],
    cite: 'OpenStreetMap node/540982491, verified 2026-08-03' },
  { id: 'hadicurari', name: 'Hadicurari Beach', terrain: 'land',
    coord: { lng: -70.0461, lat: 12.5856 },
    aliases: ['hadicurari', 'fisherman’s huts', 'fishermans huts'],
    cite: 'OpenStreetMap node/4632067907, verified 2026-08-03' },
  { id: 'hooiberg', name: 'Hooiberg', terrain: 'land',
    coord: { lng: -69.9949, lat: 12.517 },
    aliases: ['hooiberg', 'haystack mountain'],
    cite: 'OpenStreetMap node/4253910397, verified 2026-08-03' },
  { id: 'jamanota', name: 'Sero Jamanota', terrain: 'land',
    coord: { lng: -69.9405, lat: 12.4874 },
    aliases: ['jamanota'],
    cite: 'OpenStreetMap node/540217531, verified 2026-08-03' },
  { id: 'malmok', name: 'Malmok Beach', terrain: 'land',
    coord: { lng: -70.0514, lat: 12.6038 },
    aliases: ['malmok', 'malmok beach'],
    cite: 'OpenStreetMap node/4258604521, verified 2026-08-03' },
  { id: 'mangel-halto', name: 'Mangel Halto', terrain: 'land',
    coord: { lng: -69.9695, lat: 12.4643 },
    aliases: ['mangel halto'],
    cite: 'OpenStreetMap way/463354307, verified 2026-08-03' },
  { id: 'natural-bridge', name: 'Natural Bridge', terrain: 'land',
    coord: { lng: -69.9581, lat: 12.5408 },
    aliases: ['natural bridge'],
    cite: 'OpenStreetMap node/540233078, verified 2026-08-03' },
  { id: 'nautical-club', name: 'Aruba Nautical Club', terrain: 'land',
    coord: { lng: -69.9777, lat: 12.4706 },
    aliases: ['aruba nautical club'],
    cite: 'OpenStreetMap relation/5263514, verified 2026-08-03' },
  { id: 'oranjestad', name: 'Oranjestad', terrain: 'land',
    coord: { lng: -70.0371, lat: 12.5201 },
    aliases: ['oranjestad'],
    cite: 'OpenStreetMap node/50031810, verified 2026-08-03' },
  { id: 'palm-beach', name: 'Palm Beach', terrain: 'land',
    coord: { lng: -70.049, lat: 12.5748 },
    aliases: ['palm beach'],
    cite: 'OpenStreetMap way/23060047, verified 2026-08-03' },
  { id: 'paradera', name: 'Paradera', terrain: 'land',
    coord: { lng: -70.005, lat: 12.5354 },
    aliases: ['paradera'],
    cite: 'OpenStreetMap node/4599172433, verified 2026-08-03' },
  { id: 'renaissance-marina', name: 'Renaissance Marina', terrain: 'land',
    coord: { lng: -70.0391, lat: 12.5179 },
    aliases: ['renaissance marina'],
    cite: 'OpenStreetMap node/4509681291, verified 2026-08-03' },
  { id: 'rodgers-beach', name: 'Rodgers Beach', terrain: 'land',
    coord: { lng: -69.8849, lat: 12.4179 },
    aliases: ['rodgers beach', 'rodger’s beach'],
    cite: 'OpenStreetMap way/305490212, verified 2026-08-03' },
  { id: 'san-nicolas', name: 'San Nicolas', terrain: 'land',
    coord: { lng: -69.909, lat: 12.4364 },
    aliases: ['san nicolas', 'san nicolaas'],
    cite: 'OpenStreetMap node/13111662192, verified 2026-08-03' },
  { id: 'santa-cruz', name: 'Santa Cruz', terrain: 'land',
    coord: { lng: -69.9804, lat: 12.5114 },
    aliases: ['santa cruz'],
    cite: 'OpenStreetMap node/4182294398, verified 2026-08-03' },
  { id: 'savaneta', name: 'Savaneta', terrain: 'land',
    coord: { lng: -69.9497, lat: 12.4526 },
    aliases: ['savaneta', 'zeerover', 'zeerovers'],
    cite: 'OpenStreetMap node/4258604522, verified 2026-08-03' },
  { id: 'seroe-colorado-lh', name: 'Seroe Colorado Lighthouse', terrain: 'land',
    coord: { lng: -69.8692, lat: 12.4183 },
    aliases: ['seroe colorado', 'colorado point'],
    cite: 'OpenStreetMap node/540121392, verified 2026-08-03' },
  { id: 'surfside', name: 'Surfside Beach', terrain: 'land',
    coord: { lng: -70.0296, lat: 12.508 },
    aliases: ['surfside'],
    cite: 'OpenStreetMap way/305490815, verified 2026-08-03' },
  { id: 'tanki-leendert', name: 'Tanki Leendert', terrain: 'land',
    coord: { lng: -70.0196, lat: 12.542 },
    aliases: ['tanki leendert'],
    cite: 'OpenStreetMap node/4599172432, verified 2026-08-03' },
  { id: 'tres-trapi', name: 'Tres Trapi', terrain: 'land',
    coord: { lng: -70.0513, lat: 12.6024 },
    aliases: ['tres trapi', 'three steps'],
    cite: 'OpenStreetMap node/4491605028, verified 2026-08-03' },
  { id: 'tunnel-of-love', name: 'Tunnel of Love cave', terrain: 'land',
    coord: { lng: -69.8965, lat: 12.4728 },
    aliases: ['tunnel of love'],
    cite: 'OpenStreetMap node/540167865, verified 2026-08-03' },
  { id: 'wariruri', name: 'Wariruri Bay', terrain: 'land',
    coord: { lng: -69.9852, lat: 12.559 },
    aliases: ['wariruri'],
    cite: 'OpenStreetMap relation/14759456, verified 2026-08-03' },
];

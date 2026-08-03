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
};

export const PLACES: Place[] = [
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

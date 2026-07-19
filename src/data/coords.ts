export type Coord = { lng: number; lat: number };

// Coordinates for all curated local activities.
export const ACTIVITY_COORDS: Record<string, Coord> = {
  'eagle-beach-morning':          { lng: -70.0570, lat: 12.5430 },
  'baby-beach-snorkel':           { lng: -69.8855, lat: 12.4183 },
  'arikok-hiking':                { lng: -69.9408, lat: 12.5003 },
  'california-lighthouse-sunset': { lng: -70.0628, lat: 12.6257 },
  'flamingo-renaissance':         { lng: -70.0274, lat: 12.5154 },
  'boca-catalina-snorkel':        { lng: -70.0538, lat: 12.5757 },
  'antilla-wreck-dive':           { lng: -70.0603, lat: 12.5851 },
  'zeerovers-fresh-catch':        { lng: -69.9628, lat: 12.4676 },
  'gasparito-restaurant':         { lng: -70.0416, lat: 12.5649 },
  'oranjestad-walking':           { lng: -70.0262, lat: 12.5175 },
  'kitesurfing-lesson':           { lng: -70.0534, lat: 12.5876 },
  'natural-pool-jeep':            { lng: -69.9137, lat: 12.5563 },
  'malmok-beach':                 { lng: -70.0558, lat: 12.5818 },
  'tres-trapi':                   { lng: -70.0530, lat: 12.5743 },
  'manchebo-beach':               { lng: -70.0612, lat: 12.5297 },
  'divi-beach':                   { lng: -70.0601, lat: 12.5274 },
  'mangel-halto':                 { lng: -69.9819, lat: 12.4793 },
  'rodgers-beach':                { lng: -69.8916, lat: 12.4210 },
  'boca-grandi':                  { lng: -69.9160, lat: 12.4513 },
};

// Per-item coordinate overrides for Viator items. Checked before GROUP_COORDS so
// a specific product can pin to its activity location rather than the group centroid.
// Natural Pool (Conchi), Arikok NE coast: lng -69.9137, lat 12.5563
const NATURAL_POOL: Coord = { lng: -69.9137, lat: 12.5563 };
export const VIATOR_ITEM_COORDS: Record<string, Coord> = {
  // Stub IDs
  'utv-cave-pool': NATURAL_POOL,
  'jeep-arikok':   NATURAL_POOL,
  // Live Viator IDs — natural pool / Arikok jeep tours
  '6841POOL':   NATURAL_POOL,  // Aruba Natural Pool and Indian Cave Rugged Jeep Safari
  '6841P7':     NATURAL_POOL,  // Aruba UTV Adventure to Natural Pool (Jeep Transfer)
  '6841ISLAND': NATURAL_POOL,  // Ultimate Island Jeep Safari with Natural Pool & Baby Beach
  '2455NPJEEP': NATURAL_POOL,  // Aruba Off Road Safari Tour to Natural Pool
  '441143P1':   NATURAL_POOL,  // Aruba Arikok National Park Jeep Safari: Natural Pool & Baby Beach
  '441143P8':   NATURAL_POOL,  // Aruba Natural Pool Jeep Adventure
  '358826P1':   NATURAL_POOL,  // PRIVATE Jeep Safari Natural Pool, Indian Caves & Baby Beach
  '39473P4':    NATURAL_POOL,  // Aruba Jeep Tour: Natural Pool, Caves and Baby Beach
  '47774P4':    NATURAL_POOL,  // Aruba Natural Pools Northshore Safari Tour
  '300281P9':   NATURAL_POOL,  // Arikok Sunrise Hiking Tour to Natural Pool
  '6593P16':    NATURAL_POOL,  // Aruba Natural Wonders Caves and Natural Pool Jeep Tour
  '137607P17':  NATURAL_POOL,  // Aruba Outback Safari Jeep Tour - Lighthouse, Arikok & Conchi
  '137607P20':  NATURAL_POOL,  // Aruba Private Open-Air Safari Jeep Tour + Arikok and Conchi
  '5629889P1':  NATURAL_POOL,  // Full Day Jeep Tour with Arikok National Park and Caves
  '324189P4':   NATURAL_POOL,  // National Park Arikok Jeep Safari Adventures
  '446074P1':   NATURAL_POOL,  // Private Aruba National Park Hiking & Natural Pool Swimming
  // Bus / open-air sightseeing tours — depart from Palm Beach hotel strip
  '139296P2': { lng: -70.0430, lat: 12.5620 },  // Best of Aruba weekend open bus Tours
  '139296P3': { lng: -70.0430, lat: 12.5620 },  // Aruba open bus Shore Excursion
  '6593P17':  { lng: -70.0430, lat: 12.5620 },  // Open Air Beach Bus Tour of Aruba
  '47774P1':  { lng: -70.0430, lat: 12.5620 },  // Colorful Beach Bus Sightseeing Tour
};

// Fallback coordinates for Viator groups (representative point for the group's area).
export const GROUP_COORDS: Record<string, Coord> = {
  'sailing-cruises':        { lng: -70.0476, lat: 12.5662 },
  'watersports':            { lng: -70.0465, lat: 12.5645 },
  'adventure-tours':        { lng: -69.9510, lat: 12.5070 },
  'sightseeing-tours':      { lng: -70.0262, lat: 12.5175 },
  'art-culture-history':    { lng: -70.0270, lat: 12.5180 },
  'food-drink-experiences': { lng: -70.0455, lat: 12.5630 },
};

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
export const VIATOR_ITEM_COORDS: Record<string, Coord> = {
  'utv-cave-pool': { lng: -69.9137, lat: 12.5563 },
  'jeep-arikok':   { lng: -69.9137, lat: 12.5563 },
};

// Fallback coordinates for Viator groups (representative point for the group's area).
export const GROUP_COORDS: Record<string, Coord> = {
  'sailing-cruises':        { lng: -70.0476, lat: 12.5662 },
  'watersports':            { lng: -70.0465, lat: 12.5645 },
  'adventure-tours':        { lng: -69.9137, lat: 12.5563 },
  'sightseeing-tours':      { lng: -70.0262, lat: 12.5175 },
  'art-culture-history':    { lng: -70.0270, lat: 12.5180 },
  'food-drink-experiences': { lng: -70.0455, lat: 12.5630 },
};

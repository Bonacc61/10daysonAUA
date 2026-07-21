import type { SlotEntry } from '../types';

export type Coord = { lng: number; lat: number };

// All coordinates verified against Wikipedia, PADI, latitude.to, and authoritative GPS sources.
export const ACTIVITY_COORDS: Record<string, Coord> = {
  'eagle-beach-morning':          { lng: -70.0579, lat: 12.5492 },  // Wikipedia Beaches of Aruba
  'baby-beach-snorkel':           { lng: -69.8808, lat: 12.4138 },  // Wikipedia Beaches of Aruba
  'arikok-hiking':                { lng: -69.9265, lat: 12.4988 },  // Wikipedia Arikok NP / latitude.to
  'california-lighthouse-sunset': { lng: -70.0514, lat: 12.6138 },  // Wikipedia California Lighthouse infobox
  'flamingo-renaissance':         { lng: -70.0293, lat: 12.5009 },  // latlong.net Renaissance Island
  'boca-catalina-snorkel':        { lng: -70.0515, lat: 12.6046 },  // Wikipedia Beaches of Aruba
  'antilla-wreck-dive':           { lng: -70.0580, lat: 12.6020 },  // Wikipedia SS Antilla article
  'zeerovers-fresh-catch':        { lng: -69.9466, lat: 12.4461 },  // Tripexpert/OSM: Savaneta 270A pier
  'gasparito-restaurant':         { lng: -70.0415, lat: 12.5618 },  // Mapcarta / search results
  'oranjestad-walking':           { lng: -70.0270, lat: 12.5240 },  // latitude.to Oranjestad
  'kitesurfing-lesson':           { lng: -70.0471, lat: 12.5858 },  // Hadicurari Beach (beginner lessons)
  'natural-pool-jeep':            { lng: -69.9287, lat: 12.5246 },  // Wikipedia Natural Pool (Aruba)
  'malmok-beach':                 { lng: -70.0500, lat: 12.5980 },  // Wikipedia Malmok / Beaches of Aruba
  'tres-trapi':                   { lng: -70.0555, lat: 12.5579 },  // PADI dive site listing
  'manchebo-beach':               { lng: -70.0580, lat: 12.5402 },  // Wikipedia Beaches of Aruba (onshore)
  'divi-beach':                   { lng: -70.0542, lat: 12.5259 },  // latitude.to Druif Beach
  'mangel-halto':                 { lng: -69.9695, lat: 12.4649 },  // Wikipedia Mangel Halto
  'rodgers-beach':                { lng: -69.8841, lat: 12.4172 },  // Wikipedia Beaches of Aruba
  'boca-grandi':                  { lng: -69.8739, lat: 12.4402 },  // Wikipedia Beaches of Aruba
};

// Per-item coordinate overrides for Viator items. Checked before GROUP_COORDS so
// a specific product can pin to its activity location rather than the group centroid.
// Natural Pool (Conchi): Wikipedia 12.5246°N 69.9287°W — rock pool on NE coast of Arikok NP.
const NATURAL_POOL: Coord = { lng: -69.9287, lat: 12.5246 };
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
  'adventure-tours':        { lng: -69.9265, lat: 12.4988 },  // Arikok NP entrance
  'sightseeing-tours':      { lng: -70.0270, lat: 12.5240 },  // Oranjestad
  'art-culture-history':    { lng: -70.0270, lat: 12.5240 },  // Oranjestad
  'food-drink-experiences': { lng: -70.0455, lat: 12.5630 },
};

// Best-effort coordinate for a planned slot entry: an activity's own point, a
// Viator item's point, or the item's group-area fallback. undefined when the
// item/place has no mapped coordinate (the caller then just skips geo logic).
export function coordForEntry(e: SlotEntry): Coord | undefined {
  if (e.kind === 'activity') return ACTIVITY_COORDS[e.id];
  return VIATOR_ITEM_COORDS[e.bestSellerId] ?? GROUP_COORDS[e.groupId];
}

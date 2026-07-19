import { useState, useMemo, useEffect, useRef } from 'react';
import RMap, { Marker, Popup, Source, Layer, NavigationControl } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useCatalog } from '../data/useCatalog';
import { generatePlan } from '../data/itineraryGenerator';
import { ACTIVITY_COORDS, GROUP_COORDS } from '../data/coords';
import { ACTIVITIES } from '../data/activities';
import type { Answers, PageId } from '../App';
import type { SlotEntry } from '../types';
import type { Catalog } from '../data/activitySource';

const TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN as string | undefined) ?? '';
const ARUBA_CENTER = { longitude: -70.0164, latitude: 12.5211, zoom: 11.5 };

const CAT_COLOR: Record<string, string> = {
  Beaches: '#0096C7', Activities: '#F4A261',
  Watersports: '#005F73', Food: '#E9C46A', Tours: '#6A994E',
};
const GROUP_META: Record<string, { label: string; color: string }> = {
  'sailing-cruises':        { label: 'Sailing',      color: '#0077B6' },
  'watersports':            { label: 'Watersports',  color: '#00B4D8' },
  'adventure-tours':        { label: 'Adventure',    color: '#E76F51' },
  'sightseeing-tours':      { label: 'Sightseeing',  color: '#6A994E' },
  'art-culture-history':    { label: 'Culture',      color: '#9B5DE5' },
  'food-drink-experiences': { label: 'Food & drink', color: '#F4A261' },
};

type Coord = { lng: number; lat: number };
type DayEntry = { key: string; slot: string; title: string; image: string | null; coord: Coord | null; price: string | null; duration: string | null };

function coordFor(entry: SlotEntry): Coord | null {
  if (entry.kind === 'activity') return ACTIVITY_COORDS[entry.id] ?? null;
  return GROUP_COORDS[entry.groupId] ?? null;
}

function imageFor(entry: SlotEntry, catalog: Catalog): string | null {
  if (entry.kind === 'activity') return catalog.activities.find(a => a.id === entry.id)?.image ?? null;
  return catalog.items.find(i => i.id === entry.bestSellerId)?.image_url ?? null;
}

function priceFor(entry: SlotEntry, catalog: Catalog): string | null {
  if (entry.kind === 'activity') return catalog.activities.find(a => a.id === entry.id)?.cost ?? null;
  const item = catalog.items.find(i => i.id === entry.bestSellerId);
  return item?.price_usd ? `From $${Math.round(item.price_usd)}` : null;
}

function durationFor(entry: SlotEntry, catalog: Catalog): string | null {
  if (entry.kind === 'activity') return catalog.activities.find(a => a.id === entry.id)?.duration ?? null;
  return catalog.items.find(i => i.id === entry.bestSellerId)?.duration ?? null;
}

function titleFor(entry: SlotEntry, catalog: Catalog): string {
  if (entry.kind === 'activity') return catalog.activities.find(a => a.id === entry.id)?.title ?? entry.id;
  return catalog.items.find(i => i.id === entry.bestSellerId)?.title
    ?? catalog.groups.find(g => g.id === entry.groupId)?.name
    ?? entry.groupId;
}

type AnyPopup = { lng: number; lat: number; title: string; sub: string; price?: string | null; duration?: string | null };
type Props = { answers: Answers; canSeeItinerary: boolean; setPage: (p: PageId) => void };

export default function TripMap({ answers, canSeeItinerary, setPage }: Props) {
  const { catalog } = useCatalog();
  const [popup, setPopup] = useState<AnyPopup | null>(null);
  const [activeDay, setActiveDay] = useState(1);
  const stripRef = useRef<HTMLDivElement>(null);

  const plan = useMemo(
    () => (canSeeItinerary ? generatePlan(answers, catalog) : null),
    [answers, catalog, canSeeItinerary],
  );

  // Clamp activeDay when plan length is known
  const totalDays = plan?.length ?? 0;
  const safeDay = Math.min(Math.max(activeDay, 1), totalDays || 1);
  const planDay = plan?.[safeDay - 1] ?? null;

  // Build the entries for the active day with image + coord
  const dayEntries = useMemo((): DayEntry[] => {
    if (!planDay) return [];
    const slots: Array<[string, SlotEntry[]]> = [
      ['Morning', planDay.morning],
      ['Afternoon', planDay.afternoon],
      ['Evening', planDay.evening],
    ];
    return slots.flatMap(([slot, entries]) =>
      entries.map((entry, i) => ({
        key: `${slot}-${i}`,
        slot,
        title: titleFor(entry, catalog),
        image: imageFor(entry, catalog),
        coord: coordFor(entry),
        price: priceFor(entry, catalog),
        duration: durationFor(entry, catalog),
      }))
    );
  }, [planDay, catalog]);

  // Straight-line waypoints for the active day (used as fallback + for Directions API)
  const straightCoords = useMemo((): [number, number][] =>
    dayEntries.flatMap(e => e.coord ? [[e.coord.lng, e.coord.lat]] : []),
    [dayEntries],
  );

  // Road-snapped route from Mapbox Directions API
  const [roadCoords, setRoadCoords] = useState<[number, number][] | null>(null);
  useEffect(() => {
    if (!TOKEN || straightCoords.length < 2) { setRoadCoords(null); return; }
    let alive = true;
    const coordStr = straightCoords.map(([lng, lat]) => `${lng},${lat}`).join(';');
    fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${coordStr}?geometries=geojson&overview=full&access_token=${TOKEN}`)
      .then(r => r.json())
      .then((data: { routes?: Array<{ geometry: { coordinates: [number, number][] } }> }) => {
        if (alive) setRoadCoords(data.routes?.[0]?.geometry?.coordinates ?? null);
      })
      .catch(() => { /* fall back to straight */ });
    return () => { alive = false; };
  }, [straightCoords, TOKEN]);

  // Reset strip scroll when day changes
  useEffect(() => {
    stripRef.current?.scrollTo({ left: 0, behavior: 'smooth' });
  }, [safeDay]);

  // Viator group pins
  const groupPins = useMemo(() => catalog.groups.flatMap(g => {
    const c = GROUP_COORDS[g.id];
    const meta = GROUP_META[g.id];
    if (!c || !meta) return [];
    const count = catalog.items.filter(i => i.group_id === g.id).length;
    return [{ groupId: g.id, lng: c.lng, lat: c.lat, count, ...meta }];
  }), [catalog]);

  if (!TOKEN) {
    return (
      <div style={{ minHeight: 'calc(100vh - 70px)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--cream)', padding: 24 }}>
        <div style={{ maxWidth: 440, textAlign: 'center' }}>
          <h2 className="font-display" style={{ fontSize: 30, margin: '0 0 10px' }}>One step away</h2>
          <p style={{ color: '#666', marginBottom: 16 }}>Add <code style={{ background: '#ede8de', padding: '2px 6px', borderRadius: 4 }}>VITE_MAPBOX_TOKEN=pk.ey…</code> to <code>.env.production</code></p>
        </div>
      </div>
    );
  }

  const routeCoords = roadCoords ?? straightCoords;
  const dayColor = planDay?.color ?? '#E63946';

  return (
    <div style={{ height: 'calc(100vh - 70px)', position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Map fills remaining space above the bottom panel */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <RMap
          mapboxAccessToken={TOKEN}
          initialViewState={ARUBA_CENTER}
          style={{ width: '100%', height: '100%' }}
          mapStyle="mapbox://styles/mapbox/navigation-day-v1"
          onClick={() => setPopup(null)}
        >
          <NavigationControl position="top-right" />

          {/* Road-snapped route for the active day */}
          {planDay && routeCoords.length >= 2 && (
            <Source type="geojson" data={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: routeCoords } }}>
              <Layer id="route-line" type="line" paint={{ 'line-color': dayColor, 'line-width': 4, 'line-opacity': 0.9 }} />
            </Source>
          )}

          {/* Photo pin markers for active day */}
          {planDay && dayEntries.map((e, i) => {
            if (!e.coord) return null;
            return (
              <Marker key={e.key} longitude={e.coord.lng} latitude={e.coord.lat} anchor="bottom"
                onClick={ev => { ev.originalEvent.stopPropagation(); setPopup({ lng: e.coord!.lng, lat: e.coord!.lat, title: e.title, sub: e.slot, price: e.price, duration: e.duration }); }}>
                <PhotoPin image={e.image} color={dayColor} label={String(i + 1)} />
              </Marker>
            );
          })}

          {/* Catalog: Viator group pills — shown only when no itinerary day is active */}
          {!planDay && groupPins.map(g => (
            <Marker key={g.groupId} longitude={g.lng} latitude={g.lat} anchor="center"
              onClick={ev => { ev.originalEvent.stopPropagation(); setPopup({ lng: g.lng, lat: g.lat, title: g.label, sub: `${g.count} activities on Viator` }); }}>
              <div style={{ background: g.color, color: '#fff', borderRadius: 20, padding: '5px 10px', fontSize: 11, fontWeight: 700, fontFamily: 'Inter,sans-serif', border: '2px solid #fff', boxShadow: '0 2px 8px rgba(0,0,0,0.4)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
                {g.label}<span style={{ background: 'rgba(255,255,255,0.28)', borderRadius: 10, padding: '1px 6px', fontSize: 10 }}>{g.count}</span>
              </div>
            </Marker>
          ))}

          {/* Catalog: local activity dots — shown only when no itinerary day is active */}
          {!planDay && ACTIVITIES.map(a => {
            const c = ACTIVITY_COORDS[a.id];
            if (!c) return null;
            return (
              <Marker key={a.id} longitude={c.lng} latitude={c.lat} anchor="center"
                onClick={ev => { ev.originalEvent.stopPropagation(); setPopup({ lng: c.lng, lat: c.lat, title: a.title, sub: `${a.category} · ${a.cost}` }); }}>
                <div style={{ width: 14, height: 14, borderRadius: '50%', background: CAT_COLOR[a.category] ?? '#E63946', border: '2px solid #fff', boxShadow: '0 1px 5px rgba(0,0,0,0.4)', cursor: 'pointer' }} />
              </Marker>
            );
          })}

          {/* Popup */}
          {popup && (
            <Popup longitude={popup.lng} latitude={popup.lat} closeOnClick={false} onClose={() => setPopup(null)} anchor="bottom" offset={16}>
              <div style={{ fontFamily: 'Inter,sans-serif', padding: '2px 4px', minWidth: 160 }}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>{popup.sub}</div>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#1a1a1a', marginBottom: 4 }}>{popup.title}</div>
                {(popup.price || popup.duration) && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {popup.price && <span style={{ fontSize: 11, color: '#E63946', fontWeight: 600 }}>{popup.price}</span>}
                    {popup.duration && <span style={{ fontSize: 11, color: '#888' }}>⏱ {popup.duration}</span>}
                  </div>
                )}
              </div>
            </Popup>
          )}
        </RMap>

        {/* Top-left legend — catalog mode only */}
        {!planDay && (
          <div style={{ position: 'absolute', top: 16, left: 16, zIndex: 10, background: 'rgba(255,251,240,0.97)', backdropFilter: 'blur(10px)', border: '2px solid #1a1a1a', borderRadius: 10, padding: '10px 12px', boxShadow: '0 2px 12px rgba(0,0,0,0.18)' }}>
            {Object.entries(CAT_COLOR).map(([cat, color]) => (
              <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontFamily: 'Inter,sans-serif', color: '#333' }}>{cat}</span>
              </div>
            ))}
          </div>
        )}

        {/* No-itinerary CTA */}
        {!canSeeItinerary && (
          <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 10, background: 'rgba(255,251,240,0.97)', backdropFilter: 'blur(12px)', border: '2px solid #1a1a1a', borderRadius: 12, padding: '16px 18px', maxWidth: 240, boxShadow: '0 4px 16px rgba(0,0,0,0.2)' }}>
            <div style={{ fontWeight: 700, fontSize: 14, fontFamily: 'Inter,sans-serif', marginBottom: 6 }}>Map your trip</div>
            <p style={{ fontSize: 12, color: '#666', margin: '0 0 12px', lineHeight: 1.5 }}>Answer 8 questions to see your day-by-day route mapped across Aruba.</p>
            <button onClick={() => setPage('questionnaire')} className="btn-primary" style={{ width: '100%', justifyContent: 'center', fontSize: 13 }}>Start planning →</button>
          </div>
        )}
      </div>

      {/* ── Bottom panel: day nav + activity photo strip ── */}
      {plan && planDay && (
        <div style={{ background: 'rgba(255,251,240,0.98)', backdropFilter: 'blur(12px)', borderTop: '1px solid rgba(0,0,0,0.1)', flexShrink: 0 }}>
          {/* Day navigation row */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '10px 16px 4px', gap: 12 }}>
            <button
              onClick={() => setActiveDay(d => Math.max(1, d - 1))}
              disabled={safeDay <= 1}
              style={{ width: 32, height: 32, borderRadius: '50%', border: '1.5px solid #ccc', background: safeDay <= 1 ? '#f5f5f5' : '#fff', cursor: safeDay <= 1 ? 'default' : 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', color: safeDay <= 1 ? '#ccc' : '#1a1a1a', flexShrink: 0 }}
            >‹</button>

            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: dayColor, border: '1.5px solid rgba(0,0,0,0.1)' }} />
                <span style={{ fontSize: 14, fontWeight: 700, fontFamily: 'Inter,sans-serif', color: '#1a1a1a' }}>Day {safeDay}</span>
                <span style={{ fontSize: 13, color: '#888', fontFamily: 'Inter,sans-serif' }}>of {totalDays}</span>
                <span style={{ fontSize: 13, color: '#555', fontFamily: 'Inter,sans-serif' }}>· {planDay.title}</span>
              </div>
            </div>

            <button
              onClick={() => setActiveDay(d => Math.min(totalDays, d + 1))}
              disabled={safeDay >= totalDays}
              style={{ width: 32, height: 32, borderRadius: '50%', border: '1.5px solid #ccc', background: safeDay >= totalDays ? '#f5f5f5' : '#fff', cursor: safeDay >= totalDays ? 'default' : 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', color: safeDay >= totalDays ? '#ccc' : '#1a1a1a', flexShrink: 0 }}
            >›</button>
          </div>

          {/* Horizontal photo strip */}
          <div
            ref={stripRef}
            style={{ display: 'flex', gap: 10, padding: '8px 16px 14px', overflowX: 'auto', scrollbarWidth: 'none' }}
          >
            {dayEntries.length === 0 && (
              <div style={{ fontSize: 13, color: '#aaa', fontFamily: 'Inter,sans-serif', padding: '12px 0' }}>Free day — nothing scheduled.</div>
            )}
            {dayEntries.map(e => (
              <div
                key={e.key}
                style={{ flexShrink: 0, width: 120, cursor: 'pointer' }}
                onClick={() => e.coord && setPopup({ lng: e.coord.lng, lat: e.coord.lat, title: e.title, sub: e.slot, price: e.price, duration: e.duration })}
              >
                <div style={{ width: 120, height: 72, borderRadius: 10, overflow: 'hidden', background: '#e8e2d6', border: `2px solid ${dayColor}`, flexShrink: 0 }}>
                  {e.image
                    ? <img src={e.image} alt={e.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} onError={ev => { (ev.target as HTMLImageElement).style.display = 'none'; }} />
                    : <div style={{ width: '100%', height: '100%', background: dayColor, opacity: 0.2 }} />
                  }
                </div>
                <div style={{ fontSize: 10, color: '#999', fontFamily: 'Inter,sans-serif', marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>{e.slot}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#1a1a1a', fontFamily: 'Inter,sans-serif', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', marginBottom: 3 }}>{e.title}</div>
                {(e.price || e.duration) && (
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 2 }}>
                    {e.price && <span style={{ fontSize: 10, color: '#E63946', fontWeight: 600 }}>{e.price}</span>}
                    {e.price && e.duration && <span style={{ fontSize: 10, color: '#ccc' }}>·</span>}
                    {e.duration && <span style={{ fontSize: 10, color: '#888' }}>{e.duration}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Photo pin marker: circular photo above a coloured triangle tail.
function PhotoPin({ image, color, label }: { image: string | null; color: string; label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer', filter: 'drop-shadow(0 3px 6px rgba(0,0,0,0.3))' }}>
      <div style={{ width: 50, height: 50, borderRadius: '50%', border: `3px solid ${color}`, background: '#e0dbd0', overflow: 'hidden', position: 'relative' }}>
        {image
          ? <img src={image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} onError={ev => { (ev.target as HTMLImageElement).style.display = 'none'; }} />
          : <div style={{ width: '100%', height: '100%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14, fontWeight: 700, fontFamily: 'Inter,sans-serif' }}>{label}</div>
        }
        {/* Number badge overlay — only when photo fills the circle, so label isn't shown twice */}
        {image && <div style={{ position: 'absolute', bottom: 2, right: 2, width: 16, height: 16, borderRadius: '50%', background: color, border: '1.5px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 9, fontWeight: 700, fontFamily: 'Inter,sans-serif' }}>{label}</div>}
      </div>
      {/* Triangle tail */}
      <div style={{ width: 0, height: 0, borderLeft: '7px solid transparent', borderRight: '7px solid transparent', borderTop: `9px solid ${color}`, marginTop: -1 }} />
    </div>
  );
}

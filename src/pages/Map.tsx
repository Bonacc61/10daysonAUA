import { useState, useMemo, useEffect } from 'react';
import RMap, { Marker, Popup, Source, Layer, NavigationControl } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useCatalog } from '../data/useCatalog';
import { generatePlan } from '../data/itineraryGenerator';
import { ACTIVITY_COORDS, GROUP_COORDS } from '../data/coords';
import { ACTIVITIES } from '../data/activities';
import type { Answers, PageId } from '../App';
import type { SlotEntry } from '../types';

const TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN as string | undefined) ?? '';
const ARUBA_CENTER = { longitude: -70.0164, latitude: 12.5211, zoom: 11.5 };

// Category colours for local activity pins.
const CAT_COLOR: Record<string, string> = {
  Beaches:    '#0096C7',
  Activities: '#F4A261',
  Watersports:'#005F73',
  Food:       '#E9C46A',
  Tours:      '#6A994E',
};

// Display name + colour per Viator group.
const GROUP_META: Record<string, { label: string; color: string }> = {
  'sailing-cruises':        { label: 'Sailing',   color: '#0077B6' },
  'watersports':            { label: 'Watersports',color: '#00B4D8' },
  'adventure-tours':        { label: 'Adventure', color: '#E76F51' },
  'sightseeing-tours':      { label: 'Sightseeing',color: '#6A994E' },
  'art-culture-history':    { label: 'Culture',   color: '#9B5DE5' },
  'food-drink-experiences': { label: 'Food & drink',color: '#F4A261' },
};

type Coord = { lng: number; lat: number };

function coordFor(entry: SlotEntry): Coord | null {
  if (entry.kind === 'activity') return ACTIVITY_COORDS[entry.id] ?? null;
  return GROUP_COORDS[entry.groupId] ?? null;
}

type ActivityPopup = { kind: 'activity'; lng: number; lat: number; title: string; category: string; cost: string; rating: number };
type GroupPopup   = { kind: 'group';    lng: number; lat: number; groupId: string; label: string; topItems: string[] };
type RouteMarkerPopup = { kind: 'route'; lng: number; lat: number; title: string; subtitle: string; color: string };
type AnyPopup = ActivityPopup | GroupPopup | RouteMarkerPopup;

type RouteMarker = { lng: number; lat: number; color: string; label: string; dayIndex: number; title: string; subtitle: string };
type RouteSource  = { id: string; color: string; dayIndex: number; coordinates: [number, number][] };

type Props = { answers: Answers; canSeeItinerary: boolean; setPage: (p: PageId) => void };

export default function TripMap({ answers, canSeeItinerary, setPage }: Props) {
  const { catalog } = useCatalog();
  const [popup, setPopup]         = useState<AnyPopup | null>(null);
  const [activeDay, setActiveDay] = useState<number | null>(null); // 1-based
  const [showRoute, setShowRoute] = useState(true);

  const plan = useMemo(
    () => (canSeeItinerary ? generatePlan(answers, catalog) : null),
    [answers, catalog, canSeeItinerary],
  );

  // Build itinerary route data
  const { routeMarkers, routeSources } = useMemo(() => {
    if (!plan) return { routeMarkers: [] as RouteMarker[], routeSources: [] as RouteSource[] };
    const markers: RouteMarker[] = [];
    const sources: RouteSource[] = [];

    plan.forEach((day, dayIdx) => {
      const slots = [...day.morning, ...day.afternoon, ...day.evening];
      const coords: [number, number][] = [];
      let n = 0;
      slots.forEach(entry => {
        const c = coordFor(entry);
        if (!c) return;
        n++;
        let title = '', sub = '';
        if (entry.kind === 'activity') {
          const act = catalog.activities.find(a => a.id === entry.id);
          title = act?.title ?? entry.id;
          sub = act?.category ?? '';
        } else {
          const grp = catalog.groups.find(g => g.id === entry.groupId);
          title = grp?.name ?? entry.groupId;
          sub = 'Guided activity';
        }
        markers.push({ lng: c.lng, lat: c.lat, color: day.color, label: String(n), dayIndex: dayIdx, title, subtitle: `Day ${day.day} · ${sub}` });
        coords.push([c.lng, c.lat]);
      });
      if (coords.length >= 2) sources.push({ id: `route-${dayIdx}`, color: day.color, dayIndex: dayIdx, coordinates: coords });
    });
    return { routeMarkers: markers, routeSources: sources };
  }, [plan, catalog]);

  // Road-snapped geometry fetched from Mapbox Directions API per day.
  // Falls back to straight lines (routeSources) until the fetch resolves.
  const [roadCoords, setRoadCoords] = useState<Map<string, [number, number][]>>(new Map());

  useEffect(() => {
    if (!plan || !TOKEN) return;
    setRoadCoords(new Map()); // reset when plan changes
    routeSources.forEach(async (source) => {
      const coordStr = source.coordinates.map(([lng, lat]) => `${lng},${lat}`).join(';');
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordStr}?geometries=geojson&overview=full&access_token=${TOKEN}`;
      try {
        const res = await fetch(url);
        const data = await res.json() as { routes?: Array<{ geometry: { coordinates: [number, number][] } }> };
        const coords = data.routes?.[0]?.geometry?.coordinates;
        if (coords) setRoadCoords(prev => new Map(prev).set(source.id, coords));
      } catch { /* fall back to straight line */ }
    });
  }, [routeSources, TOKEN]);

  const activeRouteMarkers = activeDay ? routeMarkers.filter(m => m.dayIndex + 1 === activeDay) : routeMarkers;
  const activeRouteSources = activeDay ? routeSources.filter(s => s.dayIndex + 1 === activeDay)  : routeSources;

  // Build Viator group pins (one per group, with item count)
  const groupPins = useMemo(() => catalog.groups.map(g => {
    const c = GROUP_COORDS[g.id];
    if (!c) return null;
    const count = catalog.items.filter(i => i.group_id === g.id).length;
    const meta  = GROUP_META[g.id] ?? { label: g.name, color: '#888' };
    const topItems = catalog.items
      .filter(i => i.group_id === g.id)
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
      .slice(0, 4)
      .map(i => i.title);
    return { groupId: g.id, lng: c.lng, lat: c.lat, count, ...meta, topItems };
  }).filter(Boolean), [catalog]);

  if (!TOKEN) {
    return (
      <div style={{ minHeight: 'calc(100vh - 70px)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--cream)', padding: 24 }}>
        <div style={{ maxWidth: 440, textAlign: 'center' }}>
          <div style={{ fontSize: 52, marginBottom: 12 }}>🗺️</div>
          <h2 className="font-display" style={{ fontSize: 30, margin: '0 0 10px' }}>One step away</h2>
          <p style={{ color: '#666', marginBottom: 16, lineHeight: 1.6 }}>
            Add your Mapbox public token to <code style={{ background: '#ede8de', padding: '2px 6px', borderRadius: 4 }}>.env.production</code>:
          </p>
          <code style={{ display: 'block', background: '#f4f0e8', padding: '12px 16px', borderRadius: 8, fontSize: 13, textAlign: 'left', border: '1px solid #ddd5c0' }}>
            VITE_MAPBOX_TOKEN=pk.ey…
          </code>
          <p style={{ color: '#999', fontSize: 13, marginTop: 10 }}>Get a free token at mapbox.com → Account → Tokens</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: 'calc(100vh - 70px)', position: 'relative', overflow: 'hidden' }}>
      <RMap
        mapboxAccessToken={TOKEN}
        initialViewState={ARUBA_CENTER}
        style={{ width: '100%', height: '100%' }}
        mapStyle="mapbox://styles/mapbox/navigation-day-v1"
        onClick={() => setPopup(null)}
      >
        <NavigationControl position="top-right" />

        {/* ── Itinerary route lines (road-snapped when Directions API has resolved) ── */}
        {showRoute && activeRouteSources.map(s => {
          const coords = roadCoords.get(s.id) ?? s.coordinates;
          return (
            <Source key={s.id} type="geojson" data={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }}>
              <Layer id={`${s.id}-line`} type="line" paint={{ 'line-color': s.color, 'line-width': 4, 'line-opacity': 0.9 }} />
            </Source>
          );
        })}

        {/* ── Itinerary numbered markers ── */}
        {showRoute && activeRouteMarkers.map((m, i) => (
          <Marker key={`rm-${i}`} longitude={m.lng} latitude={m.lat} anchor="center" onClick={e => { e.originalEvent.stopPropagation(); setPopup({ kind: 'route', lng: m.lng, lat: m.lat, title: m.title, subtitle: m.subtitle, color: m.color }); }}>
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: m.color, border: '2.5px solid #fff', boxShadow: '0 2px 8px rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700, fontFamily: 'Inter,sans-serif', cursor: 'pointer' }}>
              {m.label}
            </div>
          </Marker>
        ))}

        {/* ── Viator group cluster pins ── */}
        {groupPins.map(g => !g ? null : (
          <Marker key={`g-${g.groupId}`} longitude={g.lng} latitude={g.lat} anchor="center"
            onClick={e => { e.originalEvent.stopPropagation(); setPopup({ kind: 'group', lng: g.lng, lat: g.lat, groupId: g.groupId, label: g.label, topItems: g.topItems }); }}>
            <div style={{ background: g.color, color: '#fff', borderRadius: 20, padding: '5px 10px', fontSize: 11, fontWeight: 700, fontFamily: 'Inter,sans-serif', border: '2px solid #fff', boxShadow: '0 2px 8px rgba(0,0,0,0.4)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
              {g.label}
              <span style={{ background: 'rgba(255,255,255,0.28)', borderRadius: 10, padding: '1px 6px', fontSize: 10 }}>{g.count}</span>
            </div>
          </Marker>
        ))}

        {/* ── Local activity pins ── */}
        {ACTIVITIES.map(a => {
          const c = ACTIVITY_COORDS[a.id];
          if (!c) return null;
          const color = CAT_COLOR[a.category] ?? '#E63946';
          return (
            <Marker key={`a-${a.id}`} longitude={c.lng} latitude={c.lat} anchor="center"
              onClick={e => { e.originalEvent.stopPropagation(); setPopup({ kind: 'activity', lng: c.lng, lat: c.lat, title: a.title, category: a.category, cost: a.cost, rating: a.rating }); }}>
              <div style={{ width: 14, height: 14, borderRadius: '50%', background: color, border: '2px solid #fff', boxShadow: '0 1px 5px rgba(0,0,0,0.45)', cursor: 'pointer' }} />
            </Marker>
          );
        })}

        {/* ── Popups ── */}
        {popup && popup.kind === 'activity' && (
          <Popup longitude={popup.lng} latitude={popup.lat} closeOnClick={false} onClose={() => setPopup(null)} anchor="bottom" offset={14}>
            <div style={{ fontFamily: 'Inter,sans-serif', padding: '2px 4px', minWidth: 170 }}>
              <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>{popup.category}</div>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#1a1a1a', marginBottom: 4 }}>{popup.title}</div>
              <div style={{ display: 'flex', gap: 10, fontSize: 12, color: '#555' }}>
                <span>★ {popup.rating.toFixed(1)}</span>
                <span>{popup.cost}</span>
              </div>
            </div>
          </Popup>
        )}
        {popup && popup.kind === 'group' && (
          <Popup longitude={popup.lng} latitude={popup.lat} closeOnClick={false} onClose={() => setPopup(null)} anchor="bottom" offset={20}>
            <div style={{ fontFamily: 'Inter,sans-serif', padding: '2px 4px', minWidth: 200 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#1a1a1a', marginBottom: 8 }}>{popup.label}</div>
              {popup.topItems.map((t, i) => (
                <div key={i} style={{ fontSize: 12, color: '#444', padding: '3px 0', borderTop: i === 0 ? 'none' : '1px solid #f0ece4' }}>
                  {t}
                </div>
              ))}
              <div style={{ fontSize: 11, color: '#aaa', marginTop: 6 }}>+ more on Viator</div>
            </div>
          </Popup>
        )}
        {popup && popup.kind === 'route' && (
          <Popup longitude={popup.lng} latitude={popup.lat} closeOnClick={false} onClose={() => setPopup(null)} anchor="bottom" offset={20}>
            <div style={{ fontFamily: 'Inter,sans-serif', padding: '2px 4px', minWidth: 160 }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>{popup.subtitle}</div>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#1a1a1a' }}>{popup.title}</div>
            </div>
          </Popup>
        )}
      </RMap>

      {/* ── Top controls ── */}
      <div style={{ position: 'absolute', top: 16, left: 16, zIndex: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Legend */}
        <div style={{ background: 'rgba(255,251,240,0.97)', backdropFilter: 'blur(10px)', border: '2px solid #1a1a1a', borderRadius: 10, padding: '10px 12px', boxShadow: '0 2px 12px rgba(0,0,0,0.18)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#999', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8, fontFamily: 'Inter,sans-serif' }}>Activities</div>
          {Object.entries(CAT_COLOR).map(([cat, color]) => (
            <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, border: '1.5px solid rgba(0,0,0,0.1)', flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontFamily: 'Inter,sans-serif', color: '#333' }}>{cat}</span>
            </div>
          ))}
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #e8e2d6' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#999', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6, fontFamily: 'Inter,sans-serif' }}>Viator</div>
            {Object.values(GROUP_META).map(({ label, color }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                <div style={{ width: 22, height: 10, borderRadius: 10, background: color, flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontFamily: 'Inter,sans-serif', color: '#333' }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Day legend / route controls (shown when itinerary exists) ── */}
      {plan && plan.length > 0 && (
        <div style={{ position: 'absolute', bottom: 32, left: 16, zIndex: 10, background: 'rgba(255,251,240,0.97)', backdropFilter: 'blur(10px)', border: '2px solid #1a1a1a', borderRadius: 12, padding: '12px 14px', boxShadow: '0 4px 20px rgba(0,0,0,0.22)', maxHeight: 'calc(100vh - 300px)', overflowY: 'auto', minWidth: 170 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#999', letterSpacing: 1, textTransform: 'uppercase', fontFamily: 'Inter,sans-serif' }}>Your route</div>
            <button
              onClick={() => setShowRoute(v => !v)}
              style={{ fontSize: 11, fontWeight: 600, color: showRoute ? '#E63946' : '#aaa', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Inter,sans-serif', padding: 0 }}
            >
              {showRoute ? 'Hide' : 'Show'}
            </button>
          </div>
          {showRoute && plan.map((day, i) => (
            <button key={i} onClick={() => setActiveDay(activeDay === i + 1 ? null : i + 1)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, background: activeDay === i + 1 ? `${day.color}22` : 'transparent', border: 'none', cursor: 'pointer', padding: '5px 6px', borderRadius: 6, width: '100%', textAlign: 'left', opacity: activeDay && activeDay !== i + 1 ? 0.3 : 1, transition: 'opacity 0.2s, background 0.2s' }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: day.color, flexShrink: 0, border: '1.5px solid rgba(0,0,0,0.12)' }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: '#1a1a1a', fontFamily: 'Inter,sans-serif', whiteSpace: 'nowrap' }}>Day {day.day}</span>
              <span style={{ fontSize: 11, color: '#888', fontFamily: 'Inter,sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 90 }}>{day.title}</span>
            </button>
          ))}
          {showRoute && activeDay && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #e0d9cc' }}>
              <button onClick={() => setActiveDay(null)} style={{ fontSize: 11, color: '#E63946', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Inter,sans-serif', padding: 0, width: '100%', textAlign: 'center' }}>
                Show all days
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── No itinerary CTA ── */}
      {!canSeeItinerary && (
        <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 10, background: 'rgba(255,251,240,0.97)', backdropFilter: 'blur(12px)', border: '2px solid #1a1a1a', borderRadius: 12, padding: '16px 18px', maxWidth: 240, boxShadow: '0 4px 16px rgba(0,0,0,0.2)' }}>
          <div style={{ fontWeight: 700, fontSize: 14, fontFamily: 'Inter,sans-serif', marginBottom: 6, color: '#1a1a1a' }}>Map your trip</div>
          <p style={{ fontSize: 12, color: '#666', margin: '0 0 12px', lineHeight: 1.5 }}>Complete the questionnaire to overlay your day-by-day route.</p>
          <button onClick={() => setPage('questionnaire')} className="btn-primary" style={{ width: '100%', justifyContent: 'center', fontSize: 13 }}>
            Start planning →
          </button>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { getCachedCatalog, loadCatalog, type Catalog } from './activitySource';

// Returns the catalog: the local stub instantly, then the live Viator data
// once it loads (silent swap). On failure it stays on the stub. One shared
// fetch across all consumers (loadCatalog is memoised).
export function useCatalog(): Catalog {
  const [catalog, setCatalog] = useState<Catalog>(() => getCachedCatalog());
  useEffect(() => {
    let alive = true;
    loadCatalog().then((c) => { if (alive) setCatalog(c); });
    return () => { alive = false; };
  }, []);
  return catalog;
}

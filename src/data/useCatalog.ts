import { useEffect, useState } from 'react';
import { getCachedCatalog, loadCatalog, type Catalog } from './activitySource';

// Returns the catalog and a loading flag. loading=true while the live Viator
// fetch is in flight; once resolved (or failed) it becomes false. One shared
// fetch across all consumers (loadCatalog is memoised).
export function useCatalog(): { catalog: Catalog; loading: boolean } {
  const alreadyLoaded = !!getCachedCatalog().items.find((i) => i.viator_item_url);
  const [catalog, setCatalog] = useState<Catalog>(() => getCachedCatalog());
  const [loading, setLoading] = useState(!alreadyLoaded);
  useEffect(() => {
    if (!loading) return;
    let alive = true;
    loadCatalog().then((c) => {
      if (alive) { setCatalog(c); setLoading(false); }
    });
    return () => { alive = false; };
  }, []);
  return { catalog, loading };
}

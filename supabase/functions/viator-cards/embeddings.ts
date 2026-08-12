// Embedding router — tries providers in cheapest-first order.
// Only used at ingest time inside the viator-cards edge function; vectors are
// never shipped to the browser. What ships is a single experience_cluster_id
// string per item, derived from greedy cosine clustering over the embeddings.
//
// Provider priority (set whichever secret you have):
//   1. OpenAI  text-embedding-3-small  $0.02 / M tokens  256 dims (reduced)
//   2. Voyage  voyage-3-lite           $0.02 / M tokens  512 dims
//
// Both are equivalent in price and more than sufficient in quality for
// short product title + description strings. If neither key is set the
// function logs a warning and items ship without cluster IDs; the generator
// falls back to tag-ID Jaccard similarity automatically.

const OPENAI_MODEL = 'text-embedding-3-small';
const OPENAI_DIMS  = 256;   // text-embedding-3-small supports dimensionality
                              // reduction; 256 gives near-full quality at 1/6th
                              // the vector size — only matters for clustering speed.
const VOYAGE_MODEL = 'voyage-3-lite';

export type EmbedProvider = 'openai' | 'voyage';

// The model id that produced a vector, recorded alongside it in item_embeddings.
// A vector is only comparable to another from the SAME model — cosine between
// two models is not a weaker signal, it is meaningless — so the search function
// refuses to rank when the stored model and the active one disagree.
export const MODEL_ID: Record<EmbedProvider, string> = {
  openai: OPENAI_MODEL,
  voyage: VOYAGE_MODEL,
};

// Only the 256-dimension provider can be stored: item_embeddings.embedding is
// vector(256), and mixing dimensionalities in one column is not possible even
// if mixing models were sensible.
export function isSearchableProvider(p: EmbedProvider | null): boolean {
  return p === 'openai';
}

export function activeProvider(): EmbedProvider | null {
  if (Deno.env.get('OPENAI_API_KEY'))  return 'openai';
  if (Deno.env.get('VOYAGE_API_KEY'))  return 'voyage';
  return null;
}

async function openAIBatch(texts: string[]): Promise<number[][]> {
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: OPENAI_MODEL, input: texts, dimensions: OPENAI_DIMS }),
  });
  if (!r.ok) throw new Error(`OpenAI embed ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const body = await r.json();
  return (body.data as Array<{ embedding: number[] }>)
    .sort((a: { index?: number }, b: { index?: number }) => (a.index ?? 0) - (b.index ?? 0))
    .map((d) => d.embedding);
}

async function voyageBatch(texts: string[]): Promise<number[][]> {
  // Voyage accepts up to 128 inputs per request.
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += 128) {
    const r = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('VOYAGE_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: VOYAGE_MODEL, input: texts.slice(i, i + 128) }),
    });
    if (!r.ok) throw new Error(`Voyage embed ${r.status}: ${(await r.text()).slice(0, 160)}`);
    const body = await r.json();
    results.push(...(body.data as Array<{ embedding: number[] }>).map((d) => d.embedding));
  }
  return results;
}

// Batch-embed texts using whichever provider is configured.
// Throws if no provider is available — callers should catch and log.
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const provider = activeProvider();
  if (provider === 'openai') return openAIBatch(texts);
  if (provider === 'voyage') return voyageBatch(texts);
  throw new Error('No embedding provider configured — set OPENAI_API_KEY or VOYAGE_API_KEY');
}

// Cosine similarity in [-1, 1].
export function cosineSim(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// Connected-components clustering via union-find. Any two items whose cosine
// similarity ≥ threshold are unioned, so the relation is TRANSITIVE: two
// near-identical products end up in the same cluster even if neither is the
// other's nearest "founder" (the failure mode of greedy single-pass clustering —
// two Natural-Pool jeep safaris at cos 0.83 could otherwise attach to different
// founders and both survive). Returns itemId → clusterId, where the cluster id is
// the highest-rated member's id. Callers MUST pass ids/embeddings sorted by
// rating descending, so the smallest index in each component is its best product.
//
// O(n²) cosines — fine for n ≤ ~1000 (Aruba catalog is ~350).
export function clusterByEmbedding(
  ids: string[],
  embeddings: number[][],
  threshold: number,
): Map<string, string> {
  const n = ids.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb); // keep the best-rated (lowest index) as root
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (cosineSim(embeddings[i], embeddings[j]) >= threshold) union(i, j);
    }
  }

  const assignment = new Map<string, string>();
  for (let i = 0; i < n; i++) assignment.set(ids[i], ids[find(i)]);
  return assignment;
}

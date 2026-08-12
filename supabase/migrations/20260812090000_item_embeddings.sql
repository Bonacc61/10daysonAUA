-- Semantic search storage: keep the embeddings ingest already computes.
--
-- viator-cards embeds every product at fetch time, uses the vectors to cluster
-- duplicate experiences, and throws them away. Nothing has stored one until now.
-- Persisting them is what makes search-by-meaning possible without paying to
-- embed the catalog a second time.
--
-- WHY THERE IS A `model` COLUMN
-- A vector is only comparable to another vector produced by the SAME model.
-- Cosine similarity between an OpenAI embedding and a Voyage embedding is not a
-- weaker signal — it is meaningless, and it fails silently by returning
-- confident nonsense rather than an error. The column exists so a provider swap
-- is DETECTED (the search function refuses to rank on a mismatch) instead of
-- quietly degrading. Changing providers means rebuilding this table.
--
-- Vectors are never returned to the browser. They are read only by the `search`
-- edge function, under the service role.

create extension if not exists vector;

-- One row per catalog item.
create table if not exists public.item_embeddings (
  item_id    text primary key,
  embedding  vector(256) not null,
  model      text not null,
  updated_at timestamptz not null default now()
);

-- HNSW rather than IVFFlat: it needs no training step and no row-count tuning,
-- which matters at 328 rows where IVFFlat's list count would be guesswork.
-- At this size the index is not needed for speed — it is here because
-- docs/ROADMAP.md states broader Viator taxonomy ingestion is the plan, and
-- adding it later is a second migration against a bigger table.
create index if not exists item_embeddings_hnsw_idx
  on public.item_embeddings using hnsw (embedding vector_cosine_ops);

-- Read and written by the edge functions' service role only (bypasses RLS).
-- No anon policy: a client that could read this could reconstruct the catalog's
-- semantic structure, and it has no reason to.
alter table public.item_embeddings enable row level security;

-- ---------------------------------------------------------------------------
-- Query cache.
--
-- Travel searches repeat heavily — "snorkeling", "sunset", "with kids". Caching
-- the query vector means a repeat search makes ZERO third-party calls, which is
-- both the cost control and a privacy improvement.
--
-- Keyed on a SHA-256 of the NORMALISED query (trimmed, lowercased), never the
-- text itself. That distinction matters: a table of query strings would be a
-- search-history log and would need a legal basis, a retention promise and a
-- Privacy Policy entry of its own. A table of hashes is none of those things.
create table if not exists public.query_embeddings (
  query_hash text primary key,
  embedding  vector(256) not null,
  model      text not null,
  created_at timestamptz not null default now()
);

alter table public.query_embeddings enable row level security;

-- 30-day retention. The cache has no value past the point where the catalog has
-- turned over, and unbounded growth of anything derived from user input is a
-- smell even when it is hashed. Mirrors purge-old-contact-submissions.
create extension if not exists pg_cron;

select cron.schedule(
  'purge-old-query-embeddings',
  '50 3 * * *',
  $$delete from public.query_embeddings where created_at < now() - interval '30 days'$$
);

-- ---------------------------------------------------------------------------
-- Ranking function.
--
-- The Supabase JS client cannot express pgvector's `<=>` operator through
-- .select(), so the search itself lives here and the edge function calls it via
-- rpc(). That also keeps the vectors server-side by construction: the function
-- returns ids and scores, never embeddings.
--
-- `<=>` is cosine DISTANCE (0 = identical), so similarity is 1 - distance.
-- Results below min_similarity are dropped rather than padded — for a search
-- box, an irrelevant answer is worse than no answer.
create or replace function public.search_items(
  query_embedding vector(256),
  query_model     text,
  match_count     int default 30,
  min_similarity  float default 0.0
)
returns table (item_id text, similarity float)
language sql
stable
as $$
  select e.item_id,
         1 - (e.embedding <=> query_embedding) as similarity
  from public.item_embeddings e
  -- Never compare across models: a vector from a different model produces a
  -- confident, meaningless number rather than an error.
  where e.model = query_model
    and 1 - (e.embedding <=> query_embedding) >= min_similarity
  order by e.embedding <=> query_embedding
  limit match_count;
$$;

-- Service role only, like the tables it reads.
revoke all on function public.search_items(vector(256), text, int, float) from public, anon, authenticated;

-- Cache the PARSED CONSTRAINT beside the vector it was parsed alongside.
--
-- query_embeddings already stores a salted hash of a search phrase and the
-- vector it produced, for 30 days. This adds the structured reading of the same
-- phrase, on the same row, under the same retention.
--
-- WHY IT IS WORTH A COLUMN: 31 distinct queries lifetime (measured 2026-08-14),
-- so the hit rate approaches total and this is the difference between a model
-- call per SEARCH and a model call per NEW PHRASING.
--
-- WHY IT IS NOT A FREE CHANGE, and this is recorded rather than waved through:
-- a vector is 256 opaque numbers, while `{"mustNot": ["boat"]}` is legible. A
-- readable inference about a traveller is a different kind of artifact from an
-- unreadable one even when the phrase itself is only ever stored as a hash, so
-- Privacy.tsx names it explicitly instead of leaving it covered by wording
-- written for the vector alone.
--
-- The concepts are a CLOSED vocabulary of ten (see supabase/functions/search/
-- parse.ts), none of which is a special category of data, and the phrase that
-- produced them is still never stored.
--
-- `parsed_constraint`, not `constraint` — the latter is reserved in Postgres and
-- would need quoting at every call site.
alter table public.query_embeddings
  add column if not exists parsed_constraint jsonb;

comment on column public.query_embeddings.parsed_constraint is
  'Structured reading of the hashed query: {must:[],mustNot:[],residual:""} over a closed vocabulary. Purged with the row at 30 days. Null on rows written before the parse existed, which the function treats as a cache miss rather than as "no constraint" — reusing one would pair a whole-query vector with a residual-query parse.';

-- RLS is unchanged and stays enabled: this table is service-role only, reachable
-- through the `search` edge function and from nowhere else. Adding a column does
-- not alter that, and it is stated here so a reader does not have to go and
-- check that the original grant still holds.

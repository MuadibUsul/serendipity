# ADR-0012: Candidate recall in PostgreSQL

- Status: accepted
- Date: 2026-11-18
- Task: `ser-p03-02a` (a vendor-free slice of `ser-p03-02`)
- Inputs: ARCH-001 §2, §5, §7.1, §10.2, §14.1, ADR-002; PLAN-001 EPIC-03, G2-B;
  [ADR-0009](0009-bilateral-eligibility-and-hard-filters.md)

## Context

ARCH-001 §7.1 recalls candidates from the database before any agent runs, and §14.1 asks for
exact filtering and nearest-neighbour recall first, deep negotiation only on a short list. PLAN-001
asks that a single city of 10k synthetic people be searchable with P95 and cost measurable. The
exact bilateral filter, `decidePair` ([ADR-0009](0009-bilateral-eligibility-and-hard-filters.md)),
runs on one pair in memory, so it cannot search a city by itself.

## Decision

1. **Recall is a superset of the exact filter.** For one person it returns the people who could
   pass `decidePair` with them, never fewer. It may keep a pair `decidePair` then refuses, but it
   must never leave out one `decidePair` would pass. `decidePair`, and the decision verifier after
   it (`ser-p03-07`), stay the authority. Property tests check this over random pairs. A
   database test checks that the SQL returns exactly what the TypeScript prefilter
   (`mayRecall`, in `@serendipity/matching`) keeps.
2. **One derived entry per person**, in `app.recall_entries`. It is built by
   `refresh()` from the approved profile snapshot, the confirmed self tags and the identity
   verdict. It holds only:
   - the hard rules, in indexable form: region, age and age range, goal and accepted goals,
     budget, dealbreakers and self tags;
   - availability as a 672-bit weekly mask, one bit per whole free quarter hour;
   - when the identity verdict runs out;
   - optionally, an embedding of the approved summary.

   An entry can be rebuilt from its sources at any time. `refresh()` removes the entry when:
   - the account is inactive;
   - matching consent is missing;
   - the identity check fails;
   - the age is unknown;
   - the profile cannot be read.

3. **Time, conservatively.** A shared stretch of _L_ minutes always holds at least
   ⌈(_L_ − 28) / 15⌉ consecutive whole quarter hours. So the query asks for that many consecutive
   bits in both masks, which never loses a pair. Dates shorter than 30 minutes are refused.
4. **What can change at any moment is checked live, not trusted from the entry**, for both
   people:
   - the account is `active`;
   - the `profile_matching` grant for the matching service is live (a revocation stops recall on
     the very next query);
   - the entry's profile version is still the approved one;
   - the identity verdict has not run out;
   - the person is not holding a date.

   A person who fails any of these is never recalled, and nobody is recalled for them.

5. **Order.** People are ordered by cosine distance between embeddings when both have one from
   the same model. Otherwise they are ordered by a hash of a caller-chosen salt and their id: a
   stable shuffle, so the same people are not always first. Ranking proper, including exposure
   fairness, is `ser-p03-03`.
6. **Embeddings.**
   - The column is `vector(1024)`, with one configured model at a time.
   - Vectors of another size, non-finite values and the zero vector are refused.
   - An embedding is stored only against the entry's current profile version, and is dropped
     when the entry is rebuilt from a new one.
   - Only the approved, matching-visible summary is embedded. Never photos, voice or transcripts
     (ARCH-001 §5).
   - No model is chosen here. 1024 dimensions is a placeholder, and choosing a model of another
     size needs a migration.
7. **No approximate (HNSW) index.** After the bilateral filters, a person's pool in the 10k city
   is 713 people at the median and at most 2,389. Those rows are ordered exactly, and the planner
   never picked an ANN index for this query. An HNSW index would only slow embedding writes (2.7×
   in the benchmark) and grow the table (136 MB → 58 MB without it). Add one when pools
   regularly reach tens of thousands, together with `hnsw.iterative_scan`.
8. **Recall returns user ids only.** Never profile data, never a reason (ADR-0009 §7).

## Measured

`npm run bench:recall` (10k people in one region, 300 random requesters, limit 20, 90-minute
dates). The machine had 4 CPUs and PostgreSQL 17.11 on the same host. Times are wall-clock in the
client, so they include the round trip.

| Recall             | P50     | P95     | P99     | Max     |
| ------------------ | ------- | ------- | ------- | ------- |
| Without embeddings | 10.9 ms | 26.1 ms | 33.4 ms | 39.1 ms |
| With embeddings    | 15.3 ms | 37.2 ms | 49.6 ms | 54.1 ms |

- **Plan:** a bitmap scan of `recall_entries_region_age_idx`, then primary-key and
  consent-index probes for the live checks.
- **Refresh:** 2.1 ms per person (P95 3.1 ms); 10k people in 21 s, audited.
- **Embeddings:** 10k stored in 18 s.
- **Table:** 58 MB.

"Cost" here is database time only. Embedding and model costs belong to the provider adapter, still
to come.

## Not decided here

- **Distance.** `seeking.max_distance_km` has nothing to measure from. People have only a coarse
  region, by design: no home address (ARCH-001 §2, §10.1, D2). Where a person's travel starts
  (a chosen area, a district centroid, …) is a product and privacy decision. Until then, distance
  is not filtered anywhere, and PostGIS is used only for venues.
- **Age source.** This is still the owner's decision (ADR-0009). `refresh()` takes the age from
  its caller, and an unknown age means no entry.
- **Blocks.** There is no table for them yet. `decidePair` takes blocked ids from its caller.

## Consequences

- Whoever changes what an entry is built from must call `refresh()`:
  - approving or withdrawing a profile;
  - an identity callback;
  - a pause or account deletion (`ser-p05-04`, `ser-p05-06`).

  Until then the live checks keep a stale entry from being recalled, but its data is not
  removed. Account deletion must remove the entry and its embedding (ARCH-001 §10.2).

- Adding a hard-capable fact needs a change here as well as in `decidePair`; otherwise recall
  stays a superset only by not filtering on it.

# ADR-0014: The bilateral ranking baseline

- Status: accepted
- Date: 2026-11-19
- Task: `ser-p03-03a` (a vendor-free slice of `ser-p03-03`)
- Inputs: ARCH-001 §7.1 step 4, §7.2; PRD-001 §4.3, §5.2;
  [ADR-0012](0012-candidate-recall.md)

## Decision

1. **Each direction separately.** S(A, B) in [0, 1] measures how well B fits what A hopes for:
   - the share of A's weighted wishes for **interests** and for **communication style** that
     B's confirmed self tags meet;
   - how close their approved **summaries** are (cosine similarity, from recall), when both
     have one.

   These are averaged by weight (interests 0.45, communication 0.3, summary 0.25), over the
   parts A actually expressed.

2. **Appearance never decides.** Appearance wishes against B's consented visual tags take a fixed
   share of S, at most 0.15 (0.1 by default; 0 turns it off). A property test proves appearance
   can never move S by more than that share.
3. **A pair is as good as its weaker side:**
   `score = min(S(A,B), S(B,A)) − uncertainty − exposure`.
   - The uncertainty penalty (up to 0.1) grows as less can be compared in either direction.
   - The exposure penalty (up to 0.05) grows with how often either person was put forward
     recently, so the same few people are not offered to everyone.
4. **No wish is not a bad fit.** A person who expressed no soft preferences scores `NEUTRAL`
   (0.5) for others, never 0.
5. **Bounded exploration.** `rankCandidates` fills up to `k` slots, best pairs first. Each slot
   may instead go, with probability `exploration`, to a random candidate still above `floor`.
   The order is seeded, so a round can be reproduced, and nobody below the floor is ever chosen.
6. **Internal only.** Scores order pairs for the agents. They are never shown to a person or an
   agent, never called a probability, and no person is rated on their own (PRD-001 §5.2).

## Not decided here

- **Starting values.** The weights, floor, `k` and exploration rate are starting values. PRD-001
  §5.2 tunes them from real feedback, and E2 (DB-only vs A2A, `ser-p03-08`) compares the
  baseline against negotiation.
- **Food taste** (`ser-p02-09`) joins S as one more part once it exists.

# ADR-0015: a2a-match/0.1 is a closed vocabulary

- Status: accepted
- Date: 2026-11-19
- Task: `ser-p03-04a` (the vendor-free part of `ser-p03-04`)
- Inputs: ARCH-001 §7.3, §7.4, §1.2; PRD-001 §8.2; PLAN-001 EPIC-03

## Context

Two agents, one for each person, decide whether a pair is worth a date. Each agent knows its own
person well, and each must not leak that to the other agent, which is a model that can be
prompted. ARCH-001 §7.4 asks that no contact details, photos, raw transcripts or exact places cross
between them, and §7.3 asks for a bounded run that ends in one verdict.

## Decision

1. **No free text on the wire.** A message is `ask`, `answer` or `propose`. Every value comes from
   a fixed list: a topic, that topic's own answer scale, reason codes, or a proposal. The pair
   is an opaque UUID. The parser refuses unknown fields, so nothing can be smuggled in. A property
   test checks that no string outside the vocabulary ever survives parsing.
2. **Signals, not facts.** The server computes one coarse level per kind from the viewer's wishes
   and the other person's facts. Only facts that person marked `signal` count, and only with their
   `counterpart_disclosure` consent. The agent never receives the inputs. A property test checks
   that facts kept private cannot change the result.
3. **A pure, bounded reducer.** At most 3 questions per side, one at a time, with one proposal
   each. Out of time or model calls gives `NO_DECISION`, never a guess. `REJECT` beats
   `NEEDS_USER_CLARIFICATION`, which beats `PASS`. A refused event changes nothing. The worker
   (`ser-p03-05`) drives it and persists the result, and `NEGOTIATION_LIFECYCLE` declares the
   column it writes.
4. **`PASS` is advisory.** The deterministic verifier (`ser-p03-07`) re-checks the hard rules.

## Consequences

- The agents cannot ask open questions. New topics are a protocol version bump (`a2a-match/0.2`)
  and a review, which is the point.
- The levels are coarse on purpose. They help an agent ask a better question; they are not a
  score. Ranking stays in `@serendipity/matching`.
- The model-call and time budgets are defaults (`DEFAULT_LIMITS`) and will be tuned against the
  45 s P95 in ARCH-001 §1.2 once a real model runs.

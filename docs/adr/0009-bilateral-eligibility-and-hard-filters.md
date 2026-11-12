# ADR-0009: Bilateral eligibility and hard filters as a pure function

- **Status:** accepted
- **Date:** 2026-11-11
- **Task:** `ser-p03-01a` (the deterministic core of PLAN-001 P03-01)

## Context

PRD-001 §5.1 puts two deterministic layers in front of everything a model touches: safety and
eligibility gates, then the hard conditions both people stated, compatible in both directions.
ARCH-001 §7.1 says the same as `eligible(A→B) AND eligible(B→A)`, and ADR-002/ADR-003 there keep
models away from that decision. Supply pressure must never relax a hard condition (PRD-001 §5.1).

The inputs belong to other modules: account status (`users`), identity eligibility
(`ser-p01-04a`), the approved profile snapshot with its hard rules (`ser-p02-04a`), blocks and
active dates. Recall (`ser-p03-02`) will apply most of these in SQL, and the decision verifier
(`ser-p03-07`) must be able to re-check a model's proposal against the same rule.

## Decision

1. **One pure function**, `decidePair(a, b, context)` in `packages/matching`: no I/O, no clock, no
   model. The caller assembles each `Candidate`. SQL recall may pre-filter for speed, but a pair
   counts as eligible only if this function passed it; the verifier calls it again.
2. **Conjunction, both directions.** A pair passes only if every gate holds for both people and
   every hard rule holds each way. The decision is symmetric by construction: per-person gates run
   for both sides, pair rules compare both sides, and the directed rules (age range, accepted
   goals, dealbreakers) run once in each direction.
3. **Fail closed.** Refused, never skipped:
   - no approved profile, a snapshot of another schema version, or one that is not an object;
   - a required hard rule that is missing or malformed;
   - a hard rule this filter does not know (it cannot enforce it, so it will not ignore it);
   - an unknown or implausible age;
   - no package on offer in the region, or a budget in another currency.
4. **Only the approved snapshot.** Hard rules are read from the approved version's snapshot, which
   holds confirmed facts only (ADR-0007). `Candidate` has no field through which an inferred or
   unconfirmed value could arrive. Dealbreakers are matched against the other person's confirmed
   self tags, and nothing else.
5. **Budget.** Each person pays their own share, so the shared ceiling is the lower of the two
   budgets; it must reach the cheapest package's per-person price.
6. **Time.** The two people's weekly windows must share one unbroken stretch on one day, at least
   as long as a date. A real slot is picked later against venue capacity (`ser-p03-02`,
   `ser-p04-03`); this only rules out pairs with no chance of one.
7. **All reasons, internal only.** Every refusal that can be established is returned with the
   side it belongs to, for audit and tuning. They are never shown to a user or an agent, because
   several of them disclose the other person.
8. **Not here:** distance (needs a venue: `ser-p03-02`), and gender or orientation (not in the
   catalog; an owner and legal decision, PRD-001 §8.2).

## Open: where a person's age comes from

The filter needs each person's age in whole years. The identity module deliberately keeps no
birthdate (ADR-0008), and the profile catalog has no age fact (ADR-0007). The options:

- **A. From the verification vendor:** an age (or birth year) returned with the verdict and stored
  as a number. Cannot be misstated; needs the vendor to supply it and a retention decision.
- **B. A confirmed profile fact** (`self.age`): simple, but self-declared, so a person could state
  an age that passes someone's range.
- **C. Both:** the vendor's value when there is one, checked against the declared one.

This is the owner's decision (identity data, PLAN-001 §15) and depends on the vendor chosen in
`ser-p00-04`. Until it is made, callers pass `age: null` and every pair is refused, which is the
safe default.

## Consequences

- Nobody can be matched until the age source is decided and a package price exists for the region.
- Adding a hard-capable fact to the profile catalog needs a matching change here first; otherwise
  profiles that carry it are refused (`profile_rule_unknown`) rather than half-enforced.
- Weekly windows are compared as local times of one region. If regions ever span time zones, or
  windows may cross midnight, this rule needs revisiting.
- `ser-p03-02` must keep its SQL pre-filter no looser than this function; the property tests'
  independent statement of the rule (`pair.property.test.ts`) is the reference.

## Evidence

Property tests (fast-check): symmetry under swapping; pass exactly when an independently written
statement of every gate and rule holds; 28 single failures, applied to either side of a pair built
to fit, each reject with exactly the expected refusal; unreadable profiles never pass. 28 of 28
planted bugs were caught.

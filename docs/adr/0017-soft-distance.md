# ADR-0017: Distance is a soft preference, weighed at the venue

- Status: accepted
- Date: 2026-11-19
- Task: `ser-p03-09`
- Inputs: CHG-001 D12 (owner decision); ADR-0009; ADR-0012; ARCH-001 §7.3, §10.1 (D2 data)

## Context

`seeking.max_distance_km` was a required hard rule, but nothing could enforce it. People have only
a coarse region, and never an address. The owner also decided that how far someone will travel
should depend on how well the two people fit, and that the meeting place should be fair to both.

## Decision

1. **Not a rule about people.** `seeking.max_distance_km` is retired.
   - It is no longer hard or required, and it is private only.
   - The matching filter drops it from its rules.
   - An older approved snapshot that still holds it is read normally, and the key is ignored
     (`RETIRED_RULE_KEYS`).
   - The only location rule left is the same city region.
2. **Two soft facts in its place.** Both are optional, private only and never hard rules.
   - `self.home_area` is a district or business area code the person picks, never an address.
   - `date.max_commute_minutes` is a time from 10 to 120 minutes.
3. **Fit stretches tolerance, nothing else does.** `toleranceFor(minutes, fit)`:
   - It is the person's stated tolerance (45 minutes if unstated).
   - It stretches by up to 50% as the pair's fit goes from 0 to 1.
   - The fit is how well the two people fit each other. It is never a measure of one person's
     worth.
4. **Fair venues.** `fairVenues` in `@serendipity/venues`:
   - It keeps the venues both people can reach within their own tolerance.
   - It orders them by the longer of the two journeys, then by the two together, then by the
     given order.
   - Tests show it is symmetric between the two people. They also show it is monotone in fit:
     a better fit never loses a venue.
5. **Privacy.** Home areas are D2 data: only this function and the person's own agent use them.
   - `fairVenues` returns the venues and nothing else: no areas and no journey times. Otherwise
     the other person or their agent could work out where someone lives.
   - The catalog allows the home area no visibility but `private`, so it cannot become a matching
     input or a compatibility signal.

## Consequences

- Recall and `decidePair` no longer refuse anyone over distance. The property test that recall is
  a superset of `decidePair` still holds.
- Journey times need a maps provider (Amap or Tencent, ARCH-001 §2) behind `CommuteEstimate`.
  Until one is chosen, the venue negotiation (`ser-p03-10`) can use a district-to-district table.
- The app should offer the home area as a list of districts, never a free text field. The catalog
  pattern refuses anything that looks like an address.

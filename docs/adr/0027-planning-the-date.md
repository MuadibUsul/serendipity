# ADR-0027: Planning where and when a pair meets

- Status: accepted
- Date: 2026-11-21
- Inputs: PLAN-001 P03-10 (venue negotiation), ADR-0016 (dietary needs), ADR-0017 (soft distance),
  ADR-003 (agents propose, the system decides)

## Decision

1. **The choice is deterministic.** Agents may talk about what each person likes. The venue and
   time are chosen by `planDate` in `@serendipity/venues`, so the choice is repeatable and
   explainable and never invents a table.
2. **A slot is possible only when all of these hold:**
   - it is open with a free table;
   - it starts 24 hours to 14 days from now;
   - it lies wholly inside a weekly window of each person, in Pacific time;
   - its price per person is within each person's budget, which is a hard rule;
   - its venue serves both people's dietary needs, read only with the dietary consent;
   - both people can reach the venue within their travel tolerance, which a good fit stretches
     by up to 50%.
3. **Among the possible slots,** the soonest day wins, so a match does not go cold. On that day
   the fairest venue wins: the shorter the longer journey, the better. Then the earliest start.
4. **Privacy.**
   - The planner returns the venue and slot, or a reason for the system (`no_common_time`,
     `no_venue`). It never says whose window, budget, diet or journey ruled a slot out.
   - The date row holds only the choice. The audit records only whether a slot was found.
5. **Recording.** `pgDatePlanner.planForPair` plans only for a pair whose latest negotiation
   ended in PASS, and at most once per pair (a unique index). It records the date in `DRAFT`
   with its venue, slot and time. The verifier then moves it to `ELIGIBLE`, and the booking saga
   sends the invitations.
6. **Venue listings** (migration 0023): `area` (a home area), `price_per_person_minor` and
   `accommodates`. A venue with no area or price is not offered yet.
7. **Journeys** come from a rough table of transit minutes between the pilot's home areas
   (`travelMinutes` in `@serendipity/market`). These are planning figures, to be replaced by a
   routing service before launch.

## Not yet

- The worker that calls the verifier and then the planner for each PASS (P03-05), and retries
  a pair that found no plan when new slots appear.
- Reserving the table. This happens at `VENUE_RESERVED` in the date machine, which still runs
  through payment. The free flow (`BOTH_ACCEPTED` → venue agreed → `CONFIRMED`) needs the owner
  to review the domain change (CODEOWNERS).
- Merchant self-onboarding, which fills `area`, `price_per_person_minor` and `accommodates`
  (P04-03a).

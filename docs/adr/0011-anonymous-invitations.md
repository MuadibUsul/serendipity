# ADR-0011: Anonymous date invitations

- **Status:** accepted
- **Date:** 2026-11-18
- **Task:** `ser-p04-02`

## Context

A matched pair is invited to a date; each person accepts or declines, and an unanswered invitation
expires. Before they meet, neither may see the other's profile, photos or contact. ARCH-001 ADR-006
says this is enforced at the API layer, not only in the UI, so a client bug or a hand-made request
cannot reveal anyone. PRD-001 §7 adds that a refusal is never made public.

## Decision

1. **The date machine decides.** Accept is `PARTY_ACCEPTED` from that person only. Decline is
   `CANCEL` by that person, ending the date before any money is involved. Expiry is `EXPIRE` from
   the scheduler. `packages/domain` is unchanged.
2. **One person's side, all the way down.** The repository selects a person's invitation and the
   shared facts (state, time, venue) only. The other person's id appears in `WHERE` clauses and in
   the `CASE` that works out the side, never in a selected column. The record type has no field for
   the other person. The view is copied field by field from an allowlist, so a field added to a
   record later cannot leak.
3. **Privacy beyond identity.**
   - Whether the other person has accepted is not shown until both have.
   - A decline by the other person and an expiry look identical to the person left (`closed`, no
     reason).
   - A date that is not yours answers 404, exactly like one that does not exist.
4. **Deadlines hold without the job.** An answer at or after the deadline is refused (410), and the
   view reads `closed`, even before the expiry job (`npm run invites:expire`) has moved the date
   to `EXPIRED`.
5. **Repeats and races.**
   - The same answer twice is one answer.
   - Answers lock the date and the person's invitation, so two answers at once run one after the
     other.
   - Writes use the machine's revision as an optimistic lock.
6. **Everything is audited** in the same transaction:
   - each accept, decline, repeat, refusal and expiry;
   - attempts on dates that are not the caller's (`date.invite.not_found`).
7. **Who is calling: a seam, closed in deployment.** Sign-in does not exist yet. `Callers` resolves
   the caller:
   - In `dev` and `test`, from the `x-dev-user-id` header.
   - In `staging` and `prod`, never. Every request needing a caller is 401 until real sign-in
     replaces the implementation; no configuration turns the header on there.

## Consequences

- The mobile app can switch from its mock to these endpoints once sign-in exists.
- The booking saga (`ser-p04-06`) opens invitations with `pgInvitationRepository.open(dateId,
expiresAt)`.
- Cancelling after both accepted is `ser-p04-07`.
- How long an invitation stays open is the caller's choice for now, and should become a product
  setting.
- Real sign-in (sessions or tokens, tied to identity verification) is still to be built. Until
  then the API serves no person in a deployed environment.

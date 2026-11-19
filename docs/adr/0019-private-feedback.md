# ADR-0019: Private feedback; only a mutual yes is revealed

- Status: accepted
- Date: 2026-11-19
- Task: `ser-p05-01`
- Inputs: PRD-001 §7, §5.3; ARCH-001 §9; PLAN-001 P05-01 ("Mutual choice independent; rejection
  reasons and private notes invisible")

## Decision

1. **Three answers, nothing else.** Each person answers three questions: did they feel safe, how
   comfortable was it (1 to 5), and would they like to get to know the other better. There is no
   free text, so no private note or reason can leak.
2. **Independent and final.** Each person answers once, within 72 hours of the date's end. Nobody
   sees the other's answer, and nobody can change an answer once given.
3. **Only a mutual yes is revealed.**
   - Both said yes: both see `mutual`, and a relationship is recorded with
     `mutual_opt_in_at`. Chat does not open by itself; that is the person's choice
     (`ser-p05-02`).
   - Anything else: until the window closes, someone who said yes sees `thanks`; afterwards they
     see `closed`. A "no" looks exactly like no answer. A property test shows that a person's view
     depends on the other's answer only through whether both said yes.
4. **Safety.** "I did not feel safe" is stored as a safety flag. It is audited as
   `safety_concern`, for the safety team (`ser-p05-05`), and is never shown to the other person.
   Audit events never carry the answers themselves.

## Consequences

- The date machine must reach `POST_DATE_FEEDBACK` for feedback to open. The check-in and reveal
  flow (`ser-p04-08a`) drives it there.
- Ratings feed the ranking only in aggregate, later. They never label a person.

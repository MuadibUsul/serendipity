# ADR-0018: Pausing is one tap; resuming is a confirmation

- Status: accepted
- Date: 2026-11-19
- Task: `ser-p05-04`
- Inputs: PRD-001 §7 (关系中 / 回归), ADR-0012 (recall takes active accounts only); migration 0013

## Decision

1. **Pause** (`POST /v1/me/pause`, reason `break` or `relationship`).
   - It moves the account to `paused` and records why and since when (migration 0015).
   - Nothing else changes: the profile, consent and history stay.
   - A paused account is not matched, because recall and `decidePair` take active accounts only.
   - Pausing again only changes the reason.
   - It is refused for a suspended account and for one being deleted.
2. **Resume** (`GET` and `POST /v1/me/resume`).
   - The `GET` shows the person their own approved key preferences and lists what is still needed.
   - Matching resumes only when all of these hold:
     - the account is `paused` and no deletion was requested;
     - the matching consent (`profile_matching`) is live;
     - an approved profile exists, reviewed within the last 180 days;
     - the person sends `{"confirmed": true}`.
   - Otherwise the `POST` answers 409, and the `GET` says what to do.
3. **Nothing is inferred.** The app never decides that someone is single again, or in a
   relationship, because they went quiet. Only the person pauses and resumes.
4. Every pause, resume and refusal is audited. The status guard (migration 0013) still refuses any
   move that `ACCOUNT_LIFECYCLE` does not declare.

## Consequences

- Invitations already sent stay. The person can still decline them, and they expire after 24 hours.
  Pausing does not cancel a confirmed date: cancelling has its own flow (`ser-p04-07`).
- An account paused for deletion has no reason recorded and can never be resumed from here.

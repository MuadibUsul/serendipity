# ADR-0022: Reports hold and block at once; people decide

- Status: accepted
- Date: 2026-11-19
- Task: `ser-p05-05`
- Inputs: PRD-001 §8.1; PLAN-001 P05-05 ("High-risk events taken over by a person, audited and
  appealable"); [runbook](../runbooks/safety-emergency.md)

## Decision

1. **Who can report whom.** A person can report someone they had a date with (`POST
/v1/dates/:id/report`), choosing a category and optionally adding details for staff. "I did
   not feel safe" in post-date feedback files a `felt_unsafe` report automatically.
2. **Every report blocks.** The two are never matched again (`app.user_blocks`), whatever staff
   later decide. Blocking someone in chat does the same. Recall excludes a pair if either person
   blocked the other.
3. **High risk holds at once.** The categories are threat or violence, sexual misconduct,
   stalking, and suspected minor.
   - The reported person is held from matching (`match_hold_at`), and chat between the two
     closes.
   - Holding is not a verdict. The hold is released when staff warn or dismiss, unless another
     high-risk report about the person is still open.
4. **People decide.** Staff choose `suspend`, `warn` or `dismiss` from a queue that puts high
   risk first. A suspension sets the account to `suspended`, which stops sign-in, chat and
   matching.
5. **Appeals.** Staff record an appeal against a suspension and decide it. When it is
   overturned, the account is restored unless another suspension stands against it. The report's
   status follows `REPORT_LIFECYCLE`, and the database guards it.
6. **Who learns what.** The reported person never learns who reported them or what was said. The
   reporter sees `received`, then `handled`, never the outcome. Audits carry the category and
   risk, never the details. A person's data export lists the reports they filed.

## Consequences

- Staff decisions have no HTTP endpoint yet. They need staff accounts, which is an owner decision.
  Meanwhile they run from the runbook through the repository.
- A suspended person who deletes their account stays banned by phone number (ADR-0013
  amendment).

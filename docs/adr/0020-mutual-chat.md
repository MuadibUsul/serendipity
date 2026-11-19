# ADR-0020: Chat opens on a mutual yes; leaving, blocking or pausing closes it

- Status: accepted
- Date: 2026-11-19
- Task: `ser-p05-02`
- Inputs: PRD-001 §7, §1.6; PLAN-001 P05-02 ("Any decline, block or pause stops new messages");
  [ADR-0019](0019-private-feedback.md)

## Decision

1. **When it opens.** Chat opens when both people said yes after their date (ADR-0019).
2. **When a message may be sent.** All of these must hold (`chatRefusal`):
   - the relationship is mutual;
   - neither person has left the relationship or blocked the other;
   - both accounts are active, so pausing (ADR-0018), suspension or deletion by either person
     stops messages both ways until it ends;
   - the sender holds the `relationship_chat` consent.
3. **Leaving and blocking are final.** Either person can leave or block at any time, and chat
   closes for both. The other person is told only that chat closed: leaving, blocking, pausing and
   suspension all read the same.
4. **Enforced twice.** A trigger on `app.chat_messages` (migration 0016) refuses any message into a
   closed chat, or from anyone but the two people, even if the application code is bypassed.
5. **Privacy.**
   - A message is audited without its text.
   - The data export includes the messages a person sent, never the other person's.
   - Deleting either account deletes the relationship and every message in it.

## Consequences

- Contact exchange inside the chat (`ser-p05-03`) and reporting a message (`ser-p05-05`) build on
  this.
- A block here closes one relationship. It does not yet stop the two people being matched again.
  Feeding blocks into `decidePair`'s `blockedIds` belongs to report and ban (`ser-p05-05`).

## Amendment (2026-11-19): swapping contact details (`ser-p05-03`)

People are never kept inside the app, and their phone number or WeChat is never shown on its own
initiative.

- Either person may offer a contact card (WeChat, phone or other, one short line) while chat is
  open. The phone number used to sign in is never used.
- Each card is shown only once both have offered one, so nobody gives theirs and is left
  waiting. An offer can be withdrawn until then. Cards already swapped stay swapped.
- Leaving or blocking hides both cards.
- Audits name the kind of card, never its value.
- A person's data export lists the cards they offered. Deleting either account deletes both cards.

# @serendipity/a2a-protocol

`a2a-match/0.1`: what one person's agent may say to the other's, what it may learn about the other
person, and how a negotiation runs to exactly one verdict (ARCH-001 §7.3–7.4,
[ADR-0015](../../docs/adr/0015-a2a-protocol.md)). Pure: no I/O, no model.

- **`parseMessage(raw)`** reads one message from unknown JSON, or refuses it. Every field comes
  from a fixed menu (`TOPICS`, each with its own answer scale, `REASONS`, `PROPOSALS`), and any
  field the protocol does not name is refused. There is no free text, so a message cannot carry
  a name, a number, a place, a link, a quote, or an instruction to the other model.
- **`signalsFor(viewerWishes, other)`** gives the viewer's agent one level (`none`, `some` or
  `strong`) per kind: interests, communication and lifestyle. Only the other person's facts marked
  `signal` count, and only with their `counterpart_disclosure` consent; otherwise every level is
  `none`. The facts themselves never leave the server.
- **`step(negotiation, event)`** is the negotiation reducer. Events are messages, model calls and
  clock ticks.
  - Each side asks at most 3 questions, one at a time, and proposes once.
  - Once both have proposed: any `REJECT` gives `REJECT`; otherwise any
    `NEEDS_USER_CLARIFICATION` gives that, naming the topic; otherwise `PASS`.
  - Running out of time (45 s) or model calls (12) gives `NO_DECISION`.
  - A refused event leaves the state as it was and names why.
- **`NEGOTIATION_LIFECYCLE`** declares `app.negotiations.status`. The worker that first writes
  the column (`ser-p03-05`) adds its database guard.

A `PASS` is only a proposal. The decision verifier (`ser-p03-07`) re-checks every hard rule before
anyone is invited.

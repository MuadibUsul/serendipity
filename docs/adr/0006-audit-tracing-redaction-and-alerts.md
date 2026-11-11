# ADR-0006: Audit trail, request tracing, redaction and alert rules

- **Status:** accepted
- **Date:** 2026-11-11
- **Task:** `ser-p01-07a` (the part of PLAN-001 P01-07 that needs no hosting decision)

## Context

PLAN-001 P01-07 asks for key writes that can be traced, privacy-redacted logs and alerts that fire.
Gate G1 forbids real photos and payments without an audit trail. Where logs, traces and alerts are
shipped depends on hosting (`ser-p00-02`, `ser-p01-02b`). What the code writes, and the rules the
alerts follow, do not.

## Decision

1. **One trace id per request, everywhere.** Every request gets a W3C Trace Context span
   (`services/api/src/tracing.ts`):
   - A valid incoming `traceparent` is continued; an invalid one is ignored, as the spec says.
   - The trace id is returned in an `x-trace-id` header and is on every log line written during
     the request (`trace_id`, `span_id`).
   - It is in every error response and in every audit row the request writes.
   - Fastify keeps the request's async context across body parsing. A test on a real socket keeps
     that true across upgrades.
   - Shipping spans to a tracing backend is left to `ser-p01-07`, with hosting.
2. **Audited writes are one transaction.** `inAuditedTransaction` (packages/db), which the API
   calls as `auditedTransaction`, runs the write and its `app.audit_events` row together. It
   refuses to commit if nothing was audited.
   - Every key write uses it: consent, profile approval, date transitions, payments, refunds,
     safety decisions, staff access to personal data.
   - Actions are dotted lower-case words (`safety.user.suspended`). Malformed events are refused
     before anything is written.
   - The audit table stays append-only, as migration 0006 made it.
   - The trace id is stored in `metadata_redacted.trace_id`. A column and index come with a later
     migration, once the open migrations 0007–0009 have landed, to avoid numbering clashes.
3. **Redaction as defence in depth** (`@serendipity/redact`). Code still must not log personal
   data; this removes what slips through. It runs on every log field, every log message and all
   audit metadata.
   - The value under a personal-data key (`email`, `phone`, `token`, `address`, `name`, …) is
     replaced whole.
   - Inside other strings it replaces:
     - e-mail and IM addresses;
     - 9+ digit runs and groups that add up to 9+ digits (phone, ID and card numbers);
     - resident ID numbers;
     - IPv4 and IPv6 addresses;
     - bearer tokens, JWTs and long secrets.
   - Dates and UUIDs are kept, and so are the ids this codebase generates (trace, span, request)
     and the address it listens on. A caller's `x-request-id` is accepted only if redaction would
     leave it unchanged.
   - Known over-redaction: three short numbers written in a row are taken for a phone number.
4. **Errors are problem details.** Every error response is `application/problem+json`
   (RFC 9457) with a stable `code` and the `trace_id`, and never an internal message.
   - Domain code throws `ApiError(code, detail?)`; `detail` is written for the client.
   - Nest's routing errors map to the code for their status.
   - Anything else is a bug: a bare 500, counted in `serendipity_unhandled_errors_total`, and
     logged by type and code. Its message is logged only in dev and test, and is redacted there
     too.
5. **Alert rules are code** (`infra/monitoring/alerts.yml`), tested with promtool in the
   `dev-stack` CI job (`npm run test:alerts`, Prometheus 3.15.1). The five alerts:

   | Alert                | Fires when                                                             |
   | -------------------- | ---------------------------------------------------------------------- |
   | `ApiDown`            | Scrapes have failed for 2 minutes                                      |
   | `ApiNotReady`        | `/readyz` checks have failed for 5 minutes                             |
   | `ApiHighErrorRate`   | Over 5% of non-probe requests got 5xx for 5 minutes, with real traffic |
   | `ApiUnhandledErrors` | Any unhandled error                                                    |
   | `ApiSlowRequests`    | P95 of non-probe requests over 400 ms (ARCH-001 §1.2) for 10 minutes   |

   `serendipity_ready` is computed at every scrape, so it does not depend on anyone polling
   `/readyz`. A unit test checks that every metric the rules watch is one the API exports.

## Consequences

- An operator can take one `trace_id`, from a user's error report or an alert, and find the
  request's log lines and every audit row it wrote.
- Supersedes ADR-0005 §5 on error bodies: the bare 500 is now a problem document.
- Still for `ser-p01-07`, after hosting:
  - the scrape job (`serendipity-api`);
  - Alertmanager routing and on-call;
  - log shipping and retention;
  - span export;
  - an indexed `trace_id` column on `app.audit_events`.

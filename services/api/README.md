# @serendipity/api

The modular business API (ARCH-001 §0, [ADR-0005](../../docs/adr/0005-api-service-skeleton.md)):
NestJS 12 on Fastify. So far it serves only what a platform needs to run it; business modules are
imported by `AppModule` as their tasks land.

| Endpoint       | Answers                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `GET /healthz` | Liveness: 200 while the process answers HTTP. Never touches the database                                                 |
| `GET /readyz`  | Readiness: 200 when the database answers and has every migration this build ships with; 503 naming the failing check     |
| `GET /metrics` | Prometheus text: process metrics and HTTP requests by method, route template and status. Keep it off the public internet |

## Run

```bash
# From source, against the dev database (npm run dev:up)
APP_ENV=dev DATABASE_URL=postgresql://serendipity:serendipity@127.0.0.1:55432/serendipity_dev npm run dev:api

# As the image runs it
docker compose -f infra/docker/compose.dev.yml up --build --wait api   # http://127.0.0.1:4000/readyz
```

## Configuration

Everything in [`@serendipity/config`](../../packages/config/README.md), plus:

| Variable            | Default     | Rule                                                                                        |
| ------------------- | ----------- | ------------------------------------------------------------------------------------------- |
| `PORT`              | `4000`      | 0 to 65535; 0 picks a free port                                                             |
| `HOST`              | `127.0.0.1` | The image sets `0.0.0.0`                                                                    |
| `SHUTDOWN_DELAY_MS` | `0`         | Up to 60000: how long `/readyz` reports draining before the server stops taking connections |

The process exits 1, listing every problem, if any setting is refused, for example a dev database
in prod.

## Tracing, errors and audit

[ADR-0006](../../docs/adr/0006-audit-tracing-redaction-and-alerts.md).

- **Tracing:** every request has a W3C trace (a valid incoming `traceparent` is continued). Its
  id is returned as `x-trace-id` and is on every log line of the request (`trace_id`, `span_id`).
- **Errors:** responses are `application/problem+json`, for example
  `{ "type": "about:blank", "title": "Not found", "status": 404, "code": "not_found", "trace_id": "…" }`.
  Throw `ApiError(code, detail?)` from domain code; `detail` is shown to the client.
- **Audit:** every key write goes through `auditedTransaction(pool, async (tx) => { …; await tx.audit(event) })`,
  so the write and its audit row, which carries the trace id, commit together or not at all. The
  consent engine audits through `consentAuditSink`.
- **Logs:** every field and message is redacted (`@serendipity/redact`) as defence in depth.
- **Alerts:** `infra/monitoring/alerts.yml` watches `serendipity_ready`,
  `serendipity_http_requests_total`, `serendipity_http_request_duration_seconds` and
  `serendipity_unhandled_errors_total`.

## Rules for code here

- Inject by token: `@Inject(TOKEN)` on every constructor parameter (`src/tokens.ts`). Nothing may
  rely on decorator metadata.
- Never log a request, header, query, body, row or error message wholesale. Log the fields you
  chose; log errors with `safeError`.
- Label metrics with route templates, never raw paths.
- Write key data only through `auditedTransaction`; answer errors with `ApiError`, never with
  internal messages.

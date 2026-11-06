# ADR-0005: The API service skeleton

- **Status:** accepted
- **Date:** 2026-11-06
- **Task:** `ser-p01-09` (needed by every API task and by `ser-p01-02b`)

## Context

ARCH-001 §0 and §2 call for one modular-monolith business API in TypeScript, preferring NestJS
over plain Fastify. Before any business endpoint, a platform must be able to run it: tell whether
it is alive and whether it can serve, scrape its metrics, stop it without dropping requests, and
start it only with a configuration that belongs to its environment (ADR-0004). Logs must never
carry personal data (ARCH-001 §1.2, §10.2).

## Decision

1. **NestJS 12 on Fastify** (`@nestjs/platform-fastify`), in `services/api`. The root
   `AppModule` is where business modules (identity, consent, profile, dates, payments; ARCH-001
   §4) are imported as their tasks land.
2. **Explicit injection tokens.** Every injected dependency is named with `@Inject(TOKEN)`
   (`src/tokens.ts`) and provided by value or factory. Nothing relies on `emitDecoratorMetadata`,
   which esbuild, tsx and Vitest do not emit, so the same code runs in tests, from source and in
   the image. `experimentalDecorators` is on for `services/api` only.
3. **Probes:**
   - `GET /healthz` is liveness: 200 while the process answers HTTP. It never touches the
     database, so a database outage makes the service unready rather than restarted.
   - `GET /readyz` is readiness: 200 only when the database answers and has applied every
     migration this build ships with (`infra/migrations`, copied into the image). Otherwise 503,
     naming the failing check (`database`, `migrations`, `process`). Migrations applied by a
     newer build do not make it unready: deploys migrate before new code rolls out, and the
     instances still running must keep serving.
   - `GET /metrics` is Prometheus text: Node.js process metrics, `serendipity_http_requests_total`
     and `serendipity_http_request_duration_seconds` by method, route template and status, and
     `serendipity_api_info{env}`. It is served on the same port and must be kept off the public
     internet by the platform (`ser-p01-02b`).
4. **Configuration:** the process reads `@serendipity/config` plus `PORT` (default 4000), `HOST`
   (default loopback; the image sets `0.0.0.0`) and `SHUTDOWN_DELAY_MS` (default 0). It exits 1,
   listing every problem, if anything is refused.
5. **Logs without personal data, by construction:** one JSON line per event (pino). Nothing is
   logged wholesale: a request is logged by route template, method, status, duration and request
   id only, never its URL, query, headers, client address or body. Unexpected errors answer a bare
   500 and are logged by type and code; their message, which can quote data, only in dev and test.
   A caller's `x-request-id` is kept only if it is a plain token. Probe requests log at debug.
6. **Graceful shutdown:** on SIGTERM or SIGINT, `/readyz` reports draining for
   `SHUTDOWN_DELAY_MS`, then the server stops accepting connections, finishes in-flight requests
   and closes the database pool, and the process exits 0. A shutdown that hangs exits 1 after
   10 seconds more. A second signal ends the process at once.
7. **Image:** `services/api/Dockerfile`, built from the repository root. esbuild bundles the
   service and the workspace packages it imports into `dist/main.js`; npm packages are installed
   with `npm ci --omit=dev` for the API workspace only. The image runs as `node`, holds no secret,
   and has a `HEALTHCHECK` on `/healthz`. The `dev-stack` CI job builds it, waits for that health
   check, checks `/readyz` against the migrated dev database, checks that it refuses a dev
   database in prod, and stops it with SIGTERM.

## Consequences

- Business endpoints are added as Nest modules imported by `AppModule`, injecting by token.
- `ser-p01-02b` can deploy the image, use `/healthz` and `/readyz` as the platform's probes, set
  `SHUTDOWN_DELAY_MS` to the load balancer's deregistration time, and scrape `/metrics` privately.
- Metrics use `prom-client` 15.1.3. It now says it is replaced by `@prometheus-io/client`, its
  continuation under the Prometheus organisation; moving there is a small change to `src/metrics.ts`
  once someone approves the new package.

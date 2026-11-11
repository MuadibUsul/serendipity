# infra/monitoring

Alert rules for the API, as code ([ADR-0006](../../docs/adr/0006-audit-tracing-redaction-and-alerts.md)).

| File              | What                                                                  |
| ----------------- | --------------------------------------------------------------------- |
| `alerts.yml`      | Prometheus alert rules; they expect the scrape job `serendipity-api`  |
| `alerts.test.yml` | promtool unit tests: each alert fires on its condition, and only then |

```bash
npm run test:alerts   # promtool check + test, in the pinned prom/prometheus image (needs Docker)
```

The `dev-stack` CI job runs the same command. `services/api/src/alert-rules.test.ts` checks that
every metric the rules watch is one the API exports.

The monitoring stack is chosen with hosting (`ser-p00-02`) and wired up in `ser-p01-07`. That
covers the Prometheus scrape config, Alertmanager routing and on-call, log shipping and retention,
and span export.

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

## Rules for code here

- Inject by token: `@Inject(TOKEN)` on every constructor parameter (`src/tokens.ts`). Nothing may
  rely on decorator metadata.
- Never log a request, header, query, body, row or error message wholesale. Log the fields you
  chose; log errors with `safeError`.
- Label metrics with route templates, never raw paths.

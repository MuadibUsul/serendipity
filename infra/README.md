# infra/

| Directory     | What                                                                           | Created by   |
| ------------- | ------------------------------------------------------------------------------ | ------------ |
| `docker/`     | Compose files and images for dev / staging / prod                              | `ser-p01-02` |
| `migrations/` | PostgreSQL + PostGIS + pgvector migrations (up and down)                       | `ser-p01-03` |
| `postgres/`   | `install-ubuntu.sh`: PostgreSQL 17 + PostGIS + pgvector for local tests and CI | `ser-p01-03` |
| `monitoring/` | OpenTelemetry, dashboards, alerts                                              | `ser-p01-07` |
| `terraform/`  | Only if managed infrastructure needs it later                                  | —            |

Environments never share a database or secrets (PLAN-001 P01-02).

Migrations are plain SQL, one file each with a `-- Up Migration` and a `-- Down Migration`
section ([ADR-0003](../docs/adr/0003-database-schema-and-migrations.md)):

```bash
DATABASE_URL=postgresql://…/serendipity npm run db:migrate    # apply everything pending
DATABASE_URL=postgresql://…/serendipity npm run db:rollback   # undo the latest one
```

A new migration takes the next number (`0007_…sql`), and its down section must undo exactly what
its up section did; the `db` CI job checks that the catalog returns to its earlier state.

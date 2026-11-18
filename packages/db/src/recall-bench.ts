// npm run bench:recall -- [--people 10000] [--queries 300] [--limit 20] [--out report.json]
//
// The recall benchmark (ser-p03-02a, PLAN-001 EPIC-03: "单城 10k 合成数据可搜索，
// P95/成本可测"). In a throwaway database at DATABASE_URL (a superuser
// connection to a maintenance database), it seeds a synthetic single-region
// city, builds every recall entry through the real refresh path, and times
// recall for random people, first without embeddings and then with them.
// Times are wall-clock from this process, so they include the round trip to
// the server. Development only; never against a database with real people.
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { buildCity, createRng } from "@serendipity/fixtures";
import type { RecallContext } from "@serendipity/matching";
import pg from "pg";

import { migrate } from "./migrations.js";
import { EMBEDDING_DIMENSIONS, pgRecallRepository, recallQueryText } from "./recall.js";
import { createLoginRole, createTestDatabase, urlFor } from "./test-db.js";
import { CITY_IDENTITY_POLICY, seedCity } from "./test-recall.js";

const { values } = parseArgs({
  options: {
    people: { type: "string", default: "10000" },
    queries: { type: "string", default: "300" },
    limit: { type: "string", default: "20" },
    seed: { type: "string", default: "42" },
    out: { type: "string" },
  },
});

const PEOPLE = Number(values.people);
const QUERIES = Number(values.queries);
const LIMIT = Number(values.limit);
const NOW = new Date("2026-11-18T04:00:00Z");
const CONTEXT: RecallContext = {
  dateLengthMinutes: 90,
  cheapestPackagePerPerson: { currency: "CNY", minor: 8_800 },
};

const percentile = (sorted: readonly number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? Number.NaN;
const round = (ms: number) => Math.round(ms * 100) / 100;

function summary(times: readonly number[]) {
  const sorted = [...times].sort((a, b) => a - b);
  return {
    p50_ms: round(percentile(sorted, 50)),
    p95_ms: round(percentile(sorted, 95)),
    p99_ms: round(percentile(sorted, 99)),
    max_ms: round(sorted.at(-1) ?? Number.NaN),
    mean_ms: round(sorted.reduce((sum, t) => sum + t, 0) / sorted.length),
  };
}

const elapsed = (start: bigint) => Number(process.hrtime.bigint() - start) / 1e6;

const db = await createTestDatabase();
const role = await createLoginRole("serendipity_app");
const admin = new pg.Pool({ connectionString: db.url });
let pool: pg.Pool | undefined;
try {
  await migrate(db.url, "up");
  pool = new pg.Pool({ connectionString: urlFor(db.name, role), max: 4 });
  const recall = pgRecallRepository(pool, {
    identity: CITY_IDENTITY_POLICY,
    embeddingModel: "bench-embedding-1024",
  });
  const rng = createRng(Number(values.seed));

  let start = process.hrtime.bigint();
  const city = buildCity({
    seed: Number(values.seed),
    people: PEOPLE,
    dimensions: EMBEDDING_DIMENSIONS,
  });
  const versions = await seedCity(admin, city, new Date(NOW.getTime() - 86_400_000));
  const seedMs = elapsed(start);

  start = process.hrtime.bigint();
  const refreshTimes: number[] = [];
  for (const person of city) {
    const one = process.hrtime.bigint();
    await recall.refresh(person.id, { age: person.age }, NOW);
    refreshTimes.push(elapsed(one));
  }
  const refreshTotalMs = elapsed(start);
  await admin.query("ANALYZE");

  const requesters = Array.from({ length: QUERIES }, () => rng.pick(city).id);

  async function phase(name: string) {
    const salt = `bench-${name}`;
    // Warm the cache and the plan once, as a running service would be.
    for (const id of requesters.slice(0, 10)) {
      await recall.recall(id, { context: CONTEXT, now: NOW, limit: LIMIT, salt });
    }
    const times: number[] = [];
    const sizes: number[] = [];
    for (const id of requesters) {
      const one = process.hrtime.bigint();
      const got = await recall.recall(id, { context: CONTEXT, now: NOW, limit: LIMIT, salt });
      times.push(elapsed(one));
      sizes.push(got.length);
    }
    // The pool behind the limit: how many pass the prefilter, for a sample.
    const pools: number[] = [];
    const counting = `SELECT count(*)::int AS n FROM (${recallQueryText(CONTEXT.dateLengthMinutes)}) pool`;
    for (const id of requesters.slice(0, 50)) {
      const { rows } = await admin.query<{ n: number }>(counting, [
        id,
        NOW,
        "CNY",
        8_800,
        PEOPLE,
        salt,
      ]);
      pools.push(rows[0]?.n ?? 0);
    }
    const median = requesters[Math.floor(requesters.length / 2)] ?? "";
    const client = await pool?.connect();
    let plan: string[] = [];
    if (client !== undefined) {
      try {
        const sql = recallQueryText(CONTEXT.dateLengthMinutes);
        const { rows } = await client.query<{ "QUERY PLAN": string }>(
          `EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) ${sql}`,
          [median, NOW, "CNY", 8_800, LIMIT, salt],
        );
        plan = rows.map((row) => row["QUERY PLAN"]);
      } finally {
        client.release();
      }
    }
    const sortedPools = [...pools].sort((a, b) => a - b);
    return {
      latency: summary(times),
      recalled_per_query: { mean: round(sizes.reduce((s, n) => s + n, 0) / sizes.length) },
      prefilter_pool: {
        p50: percentile(sortedPools, 50),
        p95: percentile(sortedPools, 95),
        max: sortedPools.at(-1),
      },
      indexes_used: [
        ...new Set(
          [...plan.join("\n").matchAll(/(?:Scan using|Bitmap Index Scan on) (\w+)/g)].map(
            (match) => match[1],
          ),
        ),
      ],
      plan,
    };
  }

  const withoutEmbeddings = await phase("plain");

  start = process.hrtime.bigint();
  for (const person of city) {
    await recall.setEmbedding(person.id, versions.get(person.id) ?? "", person.embedding);
  }
  const embedMs = elapsed(start);
  await admin.query("ANALYZE");
  const withEmbeddings = await phase("embedded");

  const sizes = await admin.query<{ table: string; total: string }>(
    `SELECT pg_size_pretty(pg_total_relation_size('app.recall_entries')) AS total, 'recall_entries' AS table`,
  );
  const server = await admin.query<{ version: string }>("SELECT version()");

  const report = {
    people: PEOPLE,
    queries: QUERIES,
    limit: LIMIT,
    date_length_minutes: CONTEXT.dateLengthMinutes,
    server: server.rows[0]?.version,
    seed_ms: round(seedMs),
    refresh: { total_ms: round(refreshTotalMs), ...summary(refreshTimes) },
    embeddings_stored_ms: round(embedMs),
    table_size: sizes.rows[0]?.total,
    without_embeddings: withoutEmbeddings,
    with_embeddings: withEmbeddings,
  };
  if (values.out !== undefined) await writeFile(values.out, `${JSON.stringify(report, null, 2)}\n`);
  const show = (name: string, p: typeof withEmbeddings) =>
    `| ${name} | ${String(p.latency.p50_ms)} | ${String(p.latency.p95_ms)} | ${String(p.latency.p99_ms)} | ${String(p.latency.max_ms)} | ${String(p.prefilter_pool.p50)} / ${String(p.prefilter_pool.p95)} / ${String(p.prefilter_pool.max)} | ${p.indexes_used.join(", ")} |`;
  process.stdout.write(
    `${[
      `recall benchmark: ${String(PEOPLE)} people in one region, ${String(QUERIES)} queries, limit ${String(LIMIT)}`,
      "",
      "| recall | p50 ms | p95 ms | p99 ms | max ms | pool p50 / p95 / max | indexes |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      show("without embeddings", withoutEmbeddings),
      show("with embeddings", withEmbeddings),
      "",
      `refresh: ${String(round(refreshTotalMs / 1000))} s for ${String(PEOPLE)} (p95 ${String(report.refresh.p95_ms)} ms); embeddings stored in ${String(round(embedMs / 1000))} s; table ${String(report.table_size)}`,
    ].join("\n")}\n`,
  );
} finally {
  await pool?.end();
  await admin.end();
  await db.drop();
  await role.drop();
}

// npm run db:seed -- [--seed N] [--users N]
// Loads fixture data into the migrated, empty database at DATABASE_URL.
// Development and tests only.
import { parseArgs } from "node:util";

import { buildDataset } from "@serendipity/fixtures";
import pg from "pg";

import { seedDataset } from "./seed.js";

const { values } = parseArgs({
  options: {
    seed: { type: "string", default: "1" },
    users: { type: "string", default: "20" },
  },
});
const url = process.env["DATABASE_URL"];
if (url === undefined || url === "") throw new Error("DATABASE_URL is not set");

const data = buildDataset(Number(values.seed), { extraUsers: Number(values.users) });
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await seedDataset(client, data);
  process.stdout.write(
    `seeded ${String(data.users.length)} users and ${String(data.dates.length)} dates ` +
      `(${data.scenarios.map((s) => s.name).join(", ")}) with seed ${String(data.seed)}\n`,
  );
} finally {
  await client.end();
}

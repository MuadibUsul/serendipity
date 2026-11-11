// The alert rules (infra/monitoring/alerts.yml) watch metrics by name: a
// renamed or removed metric would silence an alert without any test failing
// in promtool, whose inputs are synthetic. This keeps the two in step.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { createMetrics } from "./metrics.js";

const RULES = readFileSync(
  new URL("../../../infra/monitoring/alerts.yml", import.meta.url),
  "utf8",
);
const HISTOGRAM_SERIES = /_(?:bucket|count|sum)$/;

async function exportedMetricNames(): Promise<Set<string>> {
  const text = await createMetrics("test", () => Promise.resolve(true)).render();
  return new Set([...text.matchAll(/^# TYPE (\S+) /gm)].map((match) => match[1] ?? ""));
}

describe("alert rules", () => {
  it("only watch metrics the API exports", async () => {
    const exported = await exportedMetricNames();
    const watched = new Set(
      [...RULES.matchAll(/\bserendipity_[a-z_]+/g)].map(([name]) =>
        name.replace(HISTOGRAM_SERIES, ""),
      ),
    );
    expect(watched.size).toBeGreaterThanOrEqual(4);
    for (const name of watched) expect(exported, `alerts.yml watches ${name}`).toContain(name);
  });

  it("cover the API being down, unready, failing, buggy and slow", () => {
    const alerts = [...RULES.matchAll(/- alert: (\w+)/g)].map(([, name]) => name);
    expect(alerts).toEqual([
      "ApiDown",
      "ApiNotReady",
      "ApiHighErrorRate",
      "ApiUnhandledErrors",
      "ApiSlowRequests",
    ]);
  });
});

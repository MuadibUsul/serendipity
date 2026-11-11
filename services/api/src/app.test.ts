import { afterEach, describe, expect, it } from "vitest";

import type { Api } from "./app.js";
import { ApiError } from "./errors.js";
import type { Readiness, ReadinessResult } from "./readiness.js";
import { READY, fixedReadiness, testApi } from "./test-support.js";
import type { LogLine } from "./test-support.js";

let running: (Api & { lines: LogLine[]; text: () => string }) | undefined;

async function start(readiness: Readiness, env?: "test" | "prod") {
  running = await testApi(readiness, env);
  return running;
}

afterEach(async () => {
  await running?.app.close();
  running = undefined;
});

const requestLines = (lines: LogLine[]) => lines.filter((line) => line["msg"] === "request");

describe("GET /healthz (liveness)", () => {
  it("answers 200 without asking the database", async () => {
    const readiness = fixedReadiness(READY);
    const { app } = await start(readiness);
    const response = await app.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(readiness.calls).toBe(0);
  });
});

describe("GET /readyz (readiness)", () => {
  const cases: [string, ReadinessResult, number][] = [
    ["ready", READY, 200],
    [
      "database unreachable",
      {
        checks: { database: "unreachable", migrations: "unchecked" },
        pendingMigrations: 0,
        newerMigrations: 0,
      },
      503,
    ],
    [
      "migrations behind",
      {
        checks: { database: "ok", migrations: "behind" },
        pendingMigrations: 2,
        newerMigrations: 0,
      },
      503,
    ],
    [
      "migrations unchecked",
      {
        checks: { database: "ok", migrations: "unchecked" },
        pendingMigrations: 0,
        newerMigrations: 0,
      },
      503,
    ],
    [
      "a newer build migrated first",
      {
        checks: { database: "ok", migrations: "current" },
        pendingMigrations: 0,
        newerMigrations: 1,
      },
      200,
    ],
  ];

  it.each(cases)("%s → %i", async (_name, result, status) => {
    const { app } = await start(fixedReadiness(result));
    const response = await app.inject({ method: "GET", url: "/readyz" });
    const metrics = (await app.inject({ method: "GET", url: "/metrics" })).body;
    expect(metrics).toContain(`serendipity_ready ${status === 200 ? "1" : "0"}`);
    expect(response.statusCode).toBe(status);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      status: status === 200 ? "ready" : "not_ready",
      checks: { process: "running", ...result.checks },
      migrations: { pending: result.pendingMigrations, newer: result.newerMigrations },
    });
  });

  it("answers 503 once the process drains, without asking the database; liveness stays 200", async () => {
    const readiness = fixedReadiness(READY);
    const { app, lifecycle } = await start(readiness);
    expect((await app.inject({ method: "GET", url: "/readyz" })).statusCode).toBe(200);

    lifecycle.drain();
    const response = await app.inject({ method: "GET", url: "/readyz" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: "not_ready",
      checks: { process: "draining", database: "unchecked", migrations: "unchecked" },
    });
    expect(readiness.calls).toBe(1);
    expect((await app.inject({ method: "GET", url: "/healthz" })).statusCode).toBe(200);
  });

  it("logs a change of readiness once, not on every probe", async () => {
    const { app, lifecycle, lines } = await start(fixedReadiness(READY));
    for (let i = 0; i < 3; i += 1) await app.inject({ method: "GET", url: "/readyz" });
    lifecycle.drain();
    for (let i = 0; i < 3; i += 1) await app.inject({ method: "GET", url: "/readyz" });
    const changes = lines.filter((line) => line["msg"] === "ready" || line["msg"] === "not ready");
    expect(changes.map((line) => [line["level"], line["msg"]])).toEqual([
      ["info", "ready"],
      ["warn", "not ready"],
    ]);
  });
});

describe("GET /metrics", () => {
  it("exposes Prometheus text, counting requests by route template and status", async () => {
    const { app } = await start(fixedReadiness(READY));
    await app.inject({ method: "GET", url: "/healthz" });
    await app.inject({ method: "GET", url: "/healthz" });
    const response = await app.inject({ method: "GET", url: "/metrics" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^text\/plain; version=0\.0\.4/);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toContain(
      'serendipity_http_requests_total{method="GET",route="/healthz",status="200"} 2',
    );
    expect(response.body).toContain("serendipity_http_request_duration_seconds_bucket{");
    expect(response.body).toContain('serendipity_api_info{env="test"} 1');
    expect(response.body).toContain("process_cpu_seconds_total");
  });

  it("reports readiness at each scrape, 0 once draining, and starts the bug counter at 0", async () => {
    const readiness = fixedReadiness(READY);
    const { app, lifecycle } = await start(readiness);
    const first = (await app.inject({ method: "GET", url: "/metrics" })).body;
    expect(first).toContain("serendipity_ready 1");
    expect(first).toContain("serendipity_unhandled_errors_total 0");
    expect(readiness.calls).toBe(1);

    lifecycle.drain();
    expect((await app.inject({ method: "GET", url: "/metrics" })).body).toContain(
      "serendipity_ready 0",
    );
  });

  it("labels a request that matched no route 'unmatched', never by its path", async () => {
    const { app } = await start(fixedReadiness(READY));
    const notFound = await app.inject({ method: "GET", url: "/users/alice@example.com/photos" });
    expect(notFound.statusCode).toBe(404);
    const metrics = (await app.inject({ method: "GET", url: "/metrics" })).body;
    expect(metrics).toContain(
      'serendipity_http_requests_total{method="GET",route="unmatched",status="404"} 1',
    );
    expect(metrics).not.toContain("alice");
  });
});

describe("request logs", () => {
  it("record method, route template, status and request id, and no personal data", async () => {
    const { app, lines, text } = await start(fixedReadiness(READY));
    await app.inject({
      method: "GET",
      url: "/healthz?email=alice@example.com&phone=13800000000",
      headers: {
        authorization: "Bearer secret-token-123",
        cookie: "session=cookie-value-456",
        "x-forwarded-for": "203.0.113.9",
        "user-agent": "AliceDevice/1.0",
      },
    });
    await app.inject({ method: "GET", url: "/users/alice@example.com" });

    const [probe, unmatched] = requestLines(lines);
    expect(probe).toMatchObject({ level: "debug", method: "GET", route: "/healthz", status: 200 });
    expect(typeof probe?.["req_id"]).toBe("string");
    expect(typeof probe?.["duration_ms"]).toBe("number");
    expect(unmatched).toMatchObject({ level: "info", route: "unmatched", status: 404 });

    for (const secret of [
      "alice",
      "13800000000",
      "secret-token-123",
      "cookie-value-456",
      "203.0.113.9",
      "AliceDevice",
    ]) {
      expect(text()).not.toContain(secret);
    }
  });

  it("keep a caller's plain request id and replace anything else", async () => {
    const { app, lines } = await start(fixedReadiness(READY));
    const kept = await app.inject({
      method: "GET",
      url: "/healthz",
      headers: { "x-request-id": "trace-abc-12345" },
    });
    expect(kept.headers["x-request-id"]).toBe("trace-abc-12345");

    const smuggled = await app.inject({
      method: "GET",
      url: "/healthz",
      headers: { "x-request-id": "call-13800138000" },
    });
    expect(smuggled.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);

    const replaced = await app.inject({
      method: "GET",
      url: "/healthz",
      headers: { "x-request-id": "alice@example.com\nforged log line" },
    });
    expect(replaced.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestLines(lines).map((line) => line["req_id"])).toEqual([
      "trace-abc-12345",
      smuggled.headers["x-request-id"],
      replaced.headers["x-request-id"],
    ]);
  });
});

describe("errors", () => {
  const failing: Readiness = {
    check: () =>
      Promise.reject(
        Object.assign(new Error("Key (email)=(alice@example.com) already exists"), {
          code: "23505",
        }),
      ),
  };

  it("answer a bug with a bare 500 problem; where real data lives, log only its type and code", async () => {
    const { app, lines, text } = await start(failing, "prod");
    const response = await app.inject({ method: "GET", url: "/readyz" });
    expect(response.statusCode).toBe(500);
    expect(response.headers["content-type"]).toMatch(/^application\/problem\+json/);
    const traceId = response.headers["x-trace-id"];
    expect(response.json()).toEqual({
      type: "about:blank",
      title: "Internal error",
      status: 500,
      code: "internal",
      trace_id: traceId,
    });
    const logged = lines.find((line) => line["msg"] === "unhandled error");
    expect(logged).toMatchObject({
      route: "/readyz",
      trace_id: traceId,
      err: { type: "Error", code: "23505" },
    });
    expect(text()).not.toContain("alice");
    const metrics = (await app.inject({ method: "GET", url: "/metrics" })).body;
    expect(metrics).toContain("serendipity_unhandled_errors_total 1");
  });

  it("log a bug's message in test, still redacted, and never send it", async () => {
    const { app, lines } = await start(failing, "test");
    const response = await app.inject({ method: "GET", url: "/readyz" });
    expect(response.body).not.toContain("alice");
    expect(response.body).not.toContain("Key (email)");
    const logged = lines.find((line) => line["msg"] === "unhandled error");
    expect(logged).toMatchObject({
      err: { message: "Key (email)=([redacted]) already exists" },
    });
  });

  it("answer an ApiError with its code and client-facing detail", async () => {
    const unavailable: Readiness = {
      check: () =>
        Promise.reject(
          new ApiError("unavailable", "Try again in a minute.", {
            cause: new Error("connect ECONNREFUSED 10.0.0.7:5432"),
          }),
        ),
    };
    const { app, lines, text } = await start(unavailable, "prod");
    const response = await app.inject({ method: "GET", url: "/readyz" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      code: "unavailable",
      title: "Temporarily unavailable",
      detail: "Try again in a minute.",
    });
    expect(lines.find((line) => line["msg"] === "request failed")).toMatchObject({
      code: "unavailable",
      err: { type: "Error" },
    });
    expect(text()).not.toContain("10.0.0.7");
    expect(lines.some((line) => line["msg"] === "unhandled error")).toBe(false);
  });

  it("do not log client errors", async () => {
    const forbidden: Readiness = { check: () => Promise.reject(new ApiError("forbidden")) };
    const { app, lines } = await start(forbidden);
    const response = await app.inject({ method: "GET", url: "/readyz" });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "forbidden", title: "Not allowed" });
    expect(response.json()).not.toHaveProperty("detail");
    expect(lines.some((line) => line["level"] === "error" || line["level"] === "warn")).toBe(false);
  });

  it("answer routing errors as problems without echoing the path", async () => {
    const { app, lines } = await start(fixedReadiness(READY));
    const response = await app.inject({ method: "POST", url: "/users/alice@example.com" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: "not_found", status: 404 });
    expect(response.body).not.toContain("alice");
    expect(lines.some((line) => line["msg"] === "unhandled error")).toBe(false);
  });
});

describe("tracing", () => {
  it("continues a caller's trace across the response, the request line and the logs", async () => {
    const { app, lines } = await start(fixedReadiness(READY));
    const traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    const response = await app.inject({ method: "GET", url: "/readyz", headers: { traceparent } });
    expect(response.headers["x-trace-id"]).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    const ready = lines.find((line) => line["msg"] === "ready");
    const request = requestLines(lines)[0];
    expect(ready?.["trace_id"]).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(request?.["trace_id"]).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(request?.["span_id"]).toBe(ready?.["span_id"]);
  });

  it("starts a new trace for each request without one", async () => {
    const { app } = await start(fixedReadiness(READY));
    const a = await app.inject({ method: "GET", url: "/healthz" });
    const b = await app.inject({
      method: "GET",
      url: "/healthz",
      headers: { traceparent: "garbage" },
    });
    expect(a.headers["x-trace-id"]).toMatch(/^[0-9a-f]{32}$/);
    expect(b.headers["x-trace-id"]).toMatch(/^[0-9a-f]{32}$/);
    expect(a.headers["x-trace-id"]).not.toBe(b.headers["x-trace-id"]);
  });
});

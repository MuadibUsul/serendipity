// The real process, from source (tsx) and as the image runs it (the esbuild
// bundle under plain Node): it refuses a configuration packages/config
// rejects, serves its probes, and drains then stops on SIGTERM.
import { execFileSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

const API_DIR = fileURLToPath(new URL("..", import.meta.url));

/** Accepted for `test`; the database is unreachable on purpose (port 1). */
const VALID = {
  APP_ENV: "test",
  DATABASE_URL: "postgresql://serendipity:serendipity@127.0.0.1:1/serendipity_test",
  PORT: "0",
  LOG_LEVEL: "info",
};

interface Running {
  readonly child: ChildProcess;
  readonly lines: Record<string, unknown>[];
  stderr(): string;
  readonly exited: Promise<number | null>;
}

const children: ChildProcess[] = [];

function run(args: readonly string[], env: Record<string, string>): Running {
  const child = spawn(process.execPath, args, {
    cwd: API_DIR,
    env: { PATH: process.env["PATH"] ?? "", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  const lines: Record<string, unknown>[] = [];
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
    const complete = stdout.split("\n");
    stdout = complete.pop() ?? "";
    for (const line of complete) {
      if (line.startsWith("{")) lines.push(JSON.parse(line) as Record<string, unknown>);
    }
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exited = new Promise<number | null>((resolve) => {
    child.on("exit", (code) => {
      resolve(code);
    });
  });
  return { child, lines, stderr: () => stderr, exited };
}

async function waitForLine(running: Running, msg: string): Promise<Record<string, unknown>> {
  for (let waited = 0; waited < 15_000; waited += 50) {
    const line = running.lines.find((candidate) => candidate["msg"] === msg);
    if (line !== undefined) return line;
    if (running.child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`no "${msg}" log line; stderr: ${running.stderr()}`);
}

afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
});

beforeAll(() => {
  execFileSync(process.execPath, ["build.js"], { cwd: API_DIR });
});

describe.each([
  ["from source", ["--import", "tsx", "src/main.ts"]],
  ["as bundled for the image", ["--enable-source-maps", "dist/main.js"]],
])("the API process %s", (_how, args) => {
  it("refuses to start with a configuration packages/config rejects, listing every problem", async () => {
    const running = run(args, {
      APP_ENV: "prod",
      DATABASE_URL: "postgresql://serendipity:serendipity@localhost:5432/serendipity_dev",
      PORT: "http",
    });
    expect(await running.exited).toBe(1);
    const stderr = running.stderr();
    expect(stderr).toContain("invalid configuration:");
    expect(stderr).toContain('DATABASE_URL: prod must use the database "serendipity_prod"');
    expect(stderr).toContain("DATABASE_URL: prod must not use a local database host");
    expect(stderr).toContain("SECRET_STORE: is required in prod");
    expect(stderr).toContain("PORT: must be a whole number");
    expect(running.lines).toEqual([]);
  }, 20_000);

  it("refuses an unknown environment", async () => {
    const running = run(args, { ...VALID, APP_ENV: "production" });
    expect(await running.exited).toBe(1);
    expect(running.stderr()).toContain("APP_ENV: must be one of dev, test, staging, prod");
  }, 20_000);

  it("serves its probes, then drains and stops on SIGTERM", async () => {
    const running = run(args, { ...VALID, SHUTDOWN_DELAY_MS: "1500" });
    const listening = await waitForLine(running, "listening");
    expect(listening).toMatchObject({ env: "test", host: "127.0.0.1", migrations: 6 });
    const base = `http://127.0.0.1:${String(listening["port"])}`;

    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    const unready = await fetch(`${base}/readyz`);
    expect(unready.status).toBe(503);
    expect(await unready.json()).toMatchObject({
      checks: { process: "running", database: "unreachable" },
    });

    running.child.kill("SIGTERM");
    await waitForLine(running, "shutting down");
    const draining = await fetch(`${base}/readyz`);
    expect(draining.status).toBe(503);
    expect(await draining.json()).toMatchObject({ checks: { process: "draining" } });
    expect((await fetch(`${base}/healthz`)).status).toBe(200);

    expect(await running.exited).toBe(0);
    expect(running.lines.map((line) => line["msg"])).toContain("stopped");
  }, 20_000);
});

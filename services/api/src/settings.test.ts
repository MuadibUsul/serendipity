import { describe, expect, it } from "vitest";

import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  DEV_AUTH_SECRET,
  MAX_SHUTDOWN_DELAY_MS,
  loadApiSettings,
} from "./settings.js";

const DEV = {
  APP_ENV: "dev",
  DATABASE_URL: "postgresql://serendipity:serendipity@127.0.0.1:55432/serendipity_dev",
};

function problemsOf(source: Record<string, string>): string[] {
  const result = loadApiSettings(source);
  return result.ok ? [] : result.problems.map((problem) => problem.variable);
}

describe("loadApiSettings", () => {
  it("defaults to loopback on port 4000 with no drain delay", () => {
    const result = loadApiSettings(DEV);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.settings.port).toBe(DEFAULT_PORT);
    expect(result.settings.host).toBe(DEFAULT_HOST);
    expect(result.settings.shutdownDelayMs).toBe(0);
    expect(result.settings.app.env).toBe("dev");
  });

  it("reads PORT, HOST and SHUTDOWN_DELAY_MS", () => {
    const result = loadApiSettings({
      ...DEV,
      PORT: "0",
      HOST: "0.0.0.0",
      SHUTDOWN_DELAY_MS: String(MAX_SHUTDOWN_DELAY_MS),
    });
    expect(result.ok && result.settings).toMatchObject({
      port: 0,
      host: "0.0.0.0",
      shutdownDelayMs: MAX_SHUTDOWN_DELAY_MS,
    });
  });

  it.each(["65536", "-1", "4000.5", "http", " 4000", "1e3"])("refuses PORT=%j", (port) => {
    expect(problemsOf({ ...DEV, PORT: port })).toEqual(["PORT"]);
  });

  it.each(["", "two words"])("refuses HOST=%j", (host) => {
    expect(problemsOf({ ...DEV, HOST: host })).toEqual(["HOST"]);
  });

  it("refuses a drain delay over a minute", () => {
    expect(problemsOf({ ...DEV, SHUTDOWN_DELAY_MS: String(MAX_SHUTDOWN_DELAY_MS + 1) })).toEqual([
      "SHUTDOWN_DELAY_MS",
    ]);
  });

  it("reports the shared configuration's problems together with its own", () => {
    const problems = problemsOf({
      APP_ENV: "prod",
      DATABASE_URL: "postgresql://serendipity:serendipity@localhost/serendipity_dev",
      PORT: "http",
    });
    expect(problems).toContain("DATABASE_URL");
    expect(problems).toContain("SECRET_STORE");
    expect(problems).toContain("PORT");
  });

  it("refuses to start without a known environment", () => {
    expect(problemsOf({ ...DEV, APP_ENV: "production" })).toEqual(["APP_ENV"]);
  });
});

describe("AUTH_SECRET", () => {
  const STAGING = {
    APP_ENV: "staging",
    SECRET_STORE: "secret-store://serendipity-staging",
    DATABASE_URL:
      "postgresql://serendipity_app:s3cret@db.example.invalid:5432/serendipity_staging?sslmode=verify-full",
  };
  const OWN = "k".repeat(48);

  it("falls back to the public dev secret in dev, and takes a long enough one", () => {
    const fallback = loadApiSettings(DEV);
    expect(fallback.ok && fallback.settings.authSecret).toBe(DEV_AUTH_SECRET);
    const own = loadApiSettings({ ...DEV, AUTH_SECRET: OWN });
    expect(own.ok && own.settings.authSecret).toBe(OWN);
  });

  it("refuses a short secret anywhere", () => {
    expect(problemsOf({ ...DEV, AUTH_SECRET: "short" })).toEqual(["AUTH_SECRET"]);
  });

  it("makes staging and prod bring their own, never the dev one", () => {
    expect(problemsOf(STAGING)).toEqual(["AUTH_SECRET"]);
    expect(problemsOf({ ...STAGING, AUTH_SECRET: DEV_AUTH_SECRET })).toEqual(["AUTH_SECRET"]);
    expect(problemsOf({ ...STAGING, AUTH_SECRET: OWN })).toEqual([]);
  });
});

describe("social sign-in client IDs", () => {
  it("offers neither provider by default", () => {
    const result = loadApiSettings(DEV);
    expect(result.ok && result.settings.socialClientIds).toEqual({ apple: [], google: [] });
  });

  it("reads comma-separated client IDs", () => {
    const result = loadApiSettings({
      ...DEV,
      APPLE_CLIENT_IDS: "com.serendip.app, com.serendip.web",
      GOOGLE_CLIENT_IDS: "123-ios.apps.googleusercontent.com",
    });
    expect(result.ok && result.settings.socialClientIds).toEqual({
      apple: ["com.serendip.app", "com.serendip.web"],
      google: ["123-ios.apps.googleusercontent.com"],
    });
  });

  it("refuses something that is not a client ID", () => {
    expect(problemsOf({ ...DEV, APPLE_CLIENT_IDS: "com.serendip.app,,x y" })).toEqual([
      "APPLE_CLIENT_IDS",
    ]);
  });
});

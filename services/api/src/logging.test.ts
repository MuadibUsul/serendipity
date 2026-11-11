import { describe, expect, it } from "vitest";

import { NestLogger, revealsErrorMessages, safeError } from "./logging.js";
import { captureLogs } from "./test-support.js";

class DuplicateKey extends Error {
  readonly code = "23505";
  override readonly name = "DuplicateKey";
}

describe("safeError", () => {
  it("keeps the type and a plain code, and the message only when asked", () => {
    const error = new DuplicateKey("Key (email)=(alice@example.com) already exists");
    expect(safeError(error, false)).toEqual({ type: "DuplicateKey", code: "23505" });
    expect(safeError(error, true)).toEqual({
      type: "DuplicateKey",
      code: "23505",
      message: "Key (email)=(alice@example.com) already exists",
    });
  });

  it("drops a code or name that is not a plain word", () => {
    const error = Object.assign(new Error("x"), { code: "alice@example.com" });
    error.name = "Error for alice@example.com";
    expect(safeError(error, false)).toEqual({ type: "Error" });
  });

  it("describes a thrown non-error by its type only", () => {
    expect(safeError("alice@example.com", false)).toEqual({ type: "string" });
    expect(safeError(undefined, true)).toEqual({ type: "undefined" });
  });

  it("reveals messages only in dev and test", () => {
    expect(revealsErrorMessages("dev")).toBe(true);
    expect(revealsErrorMessages("test")).toBe(true);
    expect(revealsErrorMessages("staging")).toBe(false);
    expect(revealsErrorMessages("prod")).toBe(false);
  });
});

describe("createLogger", () => {
  it("redacts every field and every message, as defence in depth", () => {
    const { logger, lines, text } = captureLogs();
    logger.info(
      { user: { email: "alice@example.com" }, detail: "from 203.0.113.9" },
      "call 13800138000",
    );
    expect(lines[0]).toMatchObject({
      user: { email: "[redacted]" },
      detail: "from [redacted]",
      msg: "call [redacted]",
    });
    expect(text()).not.toMatch(/alice|203\.0\.113|13800138000/);
  });
});

describe("NestLogger", () => {
  it("sends Nest's messages through the logger with their context", () => {
    const { logger, lines } = captureLogs();
    const nest = new NestLogger(logger);
    nest.log("Mapped {/healthz, GET} route", "RouterExplorer");
    nest.error("Nest can't resolve dependencies", "stack trace", "ExceptionHandler");
    nest.warn({ not: "a string" });
    expect(lines.map(({ level, context, msg }) => ({ level, context, msg }))).toEqual([
      { level: "debug", context: "RouterExplorer", msg: "Mapped {/healthz, GET} route" },
      { level: "error", context: "ExceptionHandler", msg: "Nest can't resolve dependencies" },
      { level: "warn", context: "nest", msg: "nest message" },
    ]);
  });
});

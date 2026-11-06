import type { LoggerService } from "@nestjs/common";
import type { Environment, LogLevel } from "@serendipity/config";
import { pino } from "pino";
import type { DestinationStream, Logger } from "pino";

export type { Logger };

/**
 * One JSON object per line, on stdout unless `destination` is given.
 *
 * Personal data stays out of logs by construction: nothing is logged
 * wholesale (no request, header, query, body or row objects). Callers pass
 * the fields they chose, and requests are logged by route template, never by
 * URL (ADR-0005).
 */
export function createLogger(level: LogLevel, destination?: DestinationStream): Logger {
  const options = {
    level,
    base: { service: "api" },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label: string) => ({ level: label }) },
  };
  return destination === undefined ? pino(options) : pino(options, destination);
}

/** Error messages can quote data (a duplicate e-mail, a phone number): only where no real data lives. */
export function revealsErrorMessages(env: Environment): boolean {
  return env === "dev" || env === "test";
}

export interface SafeError {
  readonly type: string;
  readonly code?: string;
  readonly message?: string;
}

const SAFE_WORD = /^[A-Za-z0-9_]{1,64}$/;

/** What may be logged about an error: its class and code, and its message only when `withMessage`. */
export function safeError(error: unknown, withMessage: boolean): SafeError {
  if (!(error instanceof Error)) return { type: typeof error };
  const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
  return {
    type: SAFE_WORD.test(error.name) ? error.name : "Error",
    ...(code !== undefined && SAFE_WORD.test(code) ? { code } : {}),
    ...(withMessage ? { message: error.message } : {}),
  };
}

type Level = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

/**
 * Nest's own messages (start-up, route mapping, dependency errors) through
 * the same logger. Its "log" level is start-up chatter, so it goes to debug.
 * Request errors never reach it: SafeExceptionFilter handles them.
 */
export class NestLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}

  log(message: unknown, ...rest: unknown[]): void {
    this.write("debug", message, rest);
  }

  error(message: unknown, ...rest: unknown[]): void {
    this.write("error", message, rest);
  }

  warn(message: unknown, ...rest: unknown[]): void {
    this.write("warn", message, rest);
  }

  debug(message: unknown, ...rest: unknown[]): void {
    this.write("debug", message, rest);
  }

  verbose(message: unknown, ...rest: unknown[]): void {
    this.write("trace", message, rest);
  }

  fatal(message: unknown, ...rest: unknown[]): void {
    this.write("fatal", message, rest);
  }

  private write(level: Level, message: unknown, rest: unknown[]): void {
    // Nest passes its context (a class name) last; a stack, if any, before it.
    const context = rest.at(-1);
    this.logger[level](
      { context: typeof context === "string" ? context : "nest" },
      typeof message === "string" ? message : "nest message",
    );
  }
}

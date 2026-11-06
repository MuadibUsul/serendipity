import { loadConfig } from "@serendipity/config";
import type { AppConfig, ConfigProblem } from "@serendipity/config";

/**
 * Everything the API process reads from its environment: the shared
 * configuration (`@serendipity/config`, which refuses cross-environment
 * mistakes) plus how this process listens and stops.
 */
export interface ApiSettings {
  readonly app: AppConfig;
  /** 0 asks the system for a free port. */
  readonly port: number;
  readonly host: string;
  /** How long `/readyz` reports draining before the server stops taking connections. */
  readonly shutdownDelayMs: number;
}

export const DEFAULT_PORT = 4000;
/** Loopback unless told otherwise; the image sets HOST=0.0.0.0. */
export const DEFAULT_HOST = "127.0.0.1";
export const MAX_SHUTDOWN_DELAY_MS = 60_000;

export type ApiSettingsResult =
  | { readonly ok: true; readonly settings: ApiSettings }
  | { readonly ok: false; readonly problems: readonly ConfigProblem[] };

type Source = Readonly<Record<string, string | undefined>>;

function parseWholeNumber(
  variable: string,
  raw: string | undefined,
  fallback: number,
  max: number,
  problems: ConfigProblem[],
): number {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || value > max) {
    problems.push({
      variable,
      message: `must be a whole number from 0 to ${String(max)}, not "${raw}"`,
    });
    return fallback;
  }
  return value;
}

/** Reads and checks every setting, collecting all problems, the shared configuration's included. */
export function loadApiSettings(source: Source): ApiSettingsResult {
  const loaded = loadConfig(source);
  const problems: ConfigProblem[] = loaded.ok ? [] : [...loaded.problems];

  const port = parseWholeNumber("PORT", source["PORT"], DEFAULT_PORT, 65_535, problems);
  const host = source["HOST"] ?? DEFAULT_HOST;
  if (host === "" || /\s/.test(host)) {
    problems.push({ variable: "HOST", message: "must be a host name or address" });
  }
  const shutdownDelayMs = parseWholeNumber(
    "SHUTDOWN_DELAY_MS",
    source["SHUTDOWN_DELAY_MS"],
    0,
    MAX_SHUTDOWN_DELAY_MS,
    problems,
  );

  if (!loaded.ok || problems.length > 0) return { ok: false, problems };
  return { ok: true, settings: { app: loaded.config, port, host, shutdownDelayMs } };
}

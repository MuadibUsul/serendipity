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
  /**
   * The key for every sign-in hash (`AUTH_SECRET`, at least 32 bytes). Dev and
   * test fall back to a fixed, public one; staging and prod must set their
   * own, and may not use that one.
   */
  readonly authSecret: string;
}

/** The secret dev and test use when none is set. Public, so useless anywhere else. */
export const DEV_AUTH_SECRET = "serendipity-dev-auth-secret-not-for-deployed-use";

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

  const authSecret = parseAuthSecret(
    loaded.ok ? loaded.config.env : null,
    source["AUTH_SECRET"],
    problems,
  );

  if (!loaded.ok || problems.length > 0) return { ok: false, problems };
  return { ok: true, settings: { app: loaded.config, port, host, shutdownDelayMs, authSecret } };
}

function parseAuthSecret(
  env: AppConfig["env"] | null,
  raw: string | undefined,
  problems: ConfigProblem[],
): string {
  const variable = "AUTH_SECRET";
  const deployed = env === "staging" || env === "prod";
  if (raw === undefined || raw === "") {
    if (deployed) problems.push({ variable, message: `${env} needs its own sign-in secret` });
    return DEV_AUTH_SECRET;
  }
  if (Buffer.byteLength(raw, "utf8") < 32) {
    problems.push({ variable, message: "must be at least 32 bytes" });
  } else if (deployed && raw === DEV_AUTH_SECRET) {
    problems.push({ variable, message: `${env} must not use the public dev secret` });
  }
  return raw;
}

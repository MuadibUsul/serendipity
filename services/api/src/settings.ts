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
  /**
   * Our app's client IDs for Sign in with Apple and Google (ADR-0026):
   * `APPLE_CLIENT_IDS` (the bundle ID, and the services ID for the web) and
   * `GOOGLE_CLIENT_IDS` (the iOS, Android and web OAuth clients), comma
   * separated. A provider with none is not offered.
   */
  readonly socialClientIds: {
    readonly apple: readonly string[];
    readonly google: readonly string[];
  };
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

  const socialClientIds = {
    apple: parseClientIds("APPLE_CLIENT_IDS", source["APPLE_CLIENT_IDS"], problems),
    google: parseClientIds("GOOGLE_CLIENT_IDS", source["GOOGLE_CLIENT_IDS"], problems),
  };

  if (!loaded.ok || problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    settings: { app: loaded.config, port, host, shutdownDelayMs, authSecret, socialClientIds },
  };
}

/** A client ID: a bundle ID or an OAuth client ID, never with spaces. */
const CLIENT_ID = /^[A-Za-z0-9._-]{3,200}$/;

function parseClientIds(
  variable: string,
  raw: string | undefined,
  problems: ConfigProblem[],
): string[] {
  if (raw === undefined || raw.trim() === "") return [];
  const ids = raw.split(",").map((id) => id.trim());
  if (!ids.every((id) => CLIENT_ID.test(id))) {
    problems.push({ variable, message: "must be client IDs separated by commas" });
    return [];
  }
  return ids;
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

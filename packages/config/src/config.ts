/**
 * Runtime configuration for every Serendipity process, read from environment
 * variables, validated as a whole, and refused at start-up when it would mix
 * environments (PLAN-001 P01-02: no shared database or secrets).
 *
 * Isolation is structural: each environment's database must be named
 * `serendipity_<env>` and its secret store must name the environment, so a
 * staging process cannot open the prod database or read prod secrets by a
 * copy-paste mistake, and the reverse.
 */
export const ENVIRONMENTS = ["dev", "test", "staging", "prod"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

/** Environments that hold real people's data and must never be pointed at anything local. */
export const DEPLOYED: readonly Environment[] = ["staging", "prod"];

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** ARCH-001 §13.2 feature flags; every one is off unless switched on explicitly. */
export const FEATURE_FLAGS = {
  visualMatching: "FEATURE_VISUAL_MATCHING",
  a2aNegotiation: "FEATURE_A2A_NEGOTIATION",
  paidBooking: "FEATURE_PAID_BOOKING",
  liveChat: "FEATURE_LIVE_CHAT",
} as const;
export type FeatureFlag = keyof typeof FEATURE_FLAGS;

/** The password the dev and test setups use; never valid where real data lives. */
export const DEV_PASSWORD = "serendipity";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0", "postgres"]);
const TLS_MODES = new Set(["require", "verify-ca", "verify-full"]);

export interface DatabaseConfig {
  readonly url: string;
  readonly host: string;
  readonly name: string;
  readonly user: string;
  readonly sslmode: string | null;
}

export interface AppConfig {
  readonly env: Environment;
  readonly database: DatabaseConfig;
  /** Where secrets come from, e.g. `env://local` (dev, test) or `aws-sm://ap-east-1/serendipity-prod`. */
  readonly secretStore: string;
  readonly features: Readonly<Record<FeatureFlag, boolean>>;
  readonly logLevel: LogLevel;
}

export interface ConfigProblem {
  readonly variable: string;
  readonly message: string;
}

export type ConfigResult =
  | { readonly ok: true; readonly config: AppConfig }
  | { readonly ok: false; readonly problems: readonly ConfigProblem[] };

type Source = Readonly<Record<string, string | undefined>>;

const isEnvironment = (value: string): value is Environment =>
  (ENVIRONMENTS as readonly string[]).includes(value);

const isLogLevel = (value: string): value is LogLevel =>
  (LOG_LEVELS as readonly string[]).includes(value);

/** The database name an environment must use. Test databases may add a suffix. */
export function databaseNameFor(env: Environment): string {
  return `serendipity_${env}`;
}

function otherEnvironments(env: Environment): Environment[] {
  return ENVIRONMENTS.filter((other) => other !== env);
}

/** Whether `text` names `env` as a word (`serendipity-prod`, `prod.db`, …), not just contains it. */
function names(text: string, env: Environment): boolean {
  return new RegExp(`(^|[^a-z])${env}([^a-z]|$)`, "i").test(text);
}

function parseDatabase(
  env: Environment,
  raw: string | undefined,
  problems: ConfigProblem[],
): DatabaseConfig | null {
  const variable = "DATABASE_URL";
  if (raw === undefined || raw === "") {
    problems.push({ variable, message: "is required" });
    return null;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    problems.push({ variable, message: "is not a URL" });
    return null;
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    problems.push({ variable, message: "must be a postgresql:// URL" });
    return null;
  }
  const database: DatabaseConfig = {
    url: raw,
    host: url.hostname.toLowerCase(),
    name: decodeURIComponent(url.pathname.replace(/^\//, "")),
    user: decodeURIComponent(url.username),
    sslmode: url.searchParams.get("sslmode"),
  };

  const expected = databaseNameFor(env);
  const nameOk = env === "test" ? database.name.startsWith(expected) : database.name === expected;
  if (!nameOk) {
    problems.push({
      variable,
      message: `${env} must use the database "${expected}"${env === "test" ? " (or a name starting with it)" : ""}, not "${database.name}"`,
    });
  }
  for (const other of otherEnvironments(env)) {
    if (names(database.host, other)) {
      problems.push({
        variable,
        message: `${env} must not use a host named for ${other} (${database.host})`,
      });
    }
  }

  if (DEPLOYED.includes(env)) {
    if (LOCAL_HOSTS.has(database.host) || database.host.endsWith(".local")) {
      problems.push({
        variable,
        message: `${env} must not use a local database host (${database.host})`,
      });
    }
    if (database.sslmode === null || !TLS_MODES.has(database.sslmode)) {
      problems.push({
        variable,
        message: `${env} must connect with TLS (sslmode=require, verify-ca or verify-full)`,
      });
    }
    if (decodeURIComponent(url.password) === DEV_PASSWORD) {
      problems.push({ variable, message: `${env} must not use the development password` });
    }
    if (/fixture/i.test(database.name) || /fixture/i.test(database.host)) {
      problems.push({ variable, message: `${env} must not use a fixture database` });
    }
  }
  return database;
}

function parseSecretStore(
  env: Environment,
  raw: string | undefined,
  problems: ConfigProblem[],
): string {
  const variable = "SECRET_STORE";
  if (!DEPLOYED.includes(env)) {
    const store = raw ?? "env://local";
    for (const deployed of DEPLOYED) {
      if (names(store, deployed)) {
        problems.push({ variable, message: `${env} must not read ${deployed} secrets (${store})` });
      }
    }
    return store;
  }
  if (raw === undefined || raw === "") {
    problems.push({ variable, message: `is required in ${env}` });
    return "";
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\/\S+$/.test(raw) || raw.startsWith("env://")) {
    problems.push({
      variable,
      message: `${env} needs a managed secret store URI such as aws-sm://region/serendipity-${env}`,
    });
  }
  if (!names(raw, env)) {
    problems.push({
      variable,
      message: `the ${env} secret store must be named for ${env} (${raw})`,
    });
  }
  for (const other of otherEnvironments(env)) {
    if (names(raw, other)) {
      problems.push({ variable, message: `${env} must not use ${other}'s secret store (${raw})` });
    }
  }
  return raw;
}

function parseFlag(variable: string, raw: string | undefined, problems: ConfigProblem[]): boolean {
  if (raw === undefined || raw === "" || raw === "false") return false;
  if (raw === "true") return true;
  problems.push({ variable, message: `must be "true" or "false", not "${raw}"` });
  return false;
}

/**
 * Parses and checks the whole configuration, collecting every problem rather
 * than stopping at the first, so one failed start-up shows everything to fix.
 */
export function loadConfig(source: Source): ConfigResult {
  const problems: ConfigProblem[] = [];
  const rawEnv = source["APP_ENV"];
  if (rawEnv === undefined || !isEnvironment(rawEnv)) {
    return {
      ok: false,
      problems: [{ variable: "APP_ENV", message: `must be one of ${ENVIRONMENTS.join(", ")}` }],
    };
  }
  const env = rawEnv;

  const database = parseDatabase(env, source["DATABASE_URL"], problems);
  const secretStore = parseSecretStore(env, source["SECRET_STORE"], problems);

  const features = {
    visualMatching: parseFlag(
      FEATURE_FLAGS.visualMatching,
      source[FEATURE_FLAGS.visualMatching],
      problems,
    ),
    a2aNegotiation: parseFlag(
      FEATURE_FLAGS.a2aNegotiation,
      source[FEATURE_FLAGS.a2aNegotiation],
      problems,
    ),
    paidBooking: parseFlag(FEATURE_FLAGS.paidBooking, source[FEATURE_FLAGS.paidBooking], problems),
    liveChat: parseFlag(FEATURE_FLAGS.liveChat, source[FEATURE_FLAGS.liveChat], problems),
  };

  const rawLevel = source["LOG_LEVEL"] ?? "info";
  let logLevel: LogLevel = "info";
  if (isLogLevel(rawLevel)) logLevel = rawLevel;
  else problems.push({ variable: "LOG_LEVEL", message: `must be one of ${LOG_LEVELS.join(", ")}` });
  if (env === "prod" && logLevel === "debug") {
    problems.push({ variable: "LOG_LEVEL", message: "prod must not log at debug level" });
  }

  if (problems.length > 0 || database === null) return { ok: false, problems };
  return { ok: true, config: { env, database, secretStore, features, logLevel } };
}

/** `loadConfig`, throwing one error that lists every problem. For process start-up. */
export function requireConfig(source: Source): AppConfig {
  const result = loadConfig(source);
  if (result.ok) return result.config;
  const lines = result.problems.map((problem) => `  ${problem.variable}: ${problem.message}`);
  throw new Error(`invalid configuration:\n${lines.join("\n")}`);
}

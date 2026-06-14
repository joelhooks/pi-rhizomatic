import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Schema } from "effect";
import { ConfigFile } from "./schema.js";

export interface ResolvedConfig {
  readonly serviceUrl?: string;
  readonly backend: "rhizomatic-http" | "chorus-http";
  readonly token?: string;
  readonly tokenSource?: string;
  readonly outboxDir: string;
  readonly sessionDir: string;
  readonly sources: readonly string[];
}

function readJson(path: string): unknown | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8"));
}

function findProjectConfig(cwd: string): string | undefined {
  let current = resolve(cwd);
  while (true) {
    const candidate = join(current, ".pi", "rhizomatic.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function loadConfigFile(path: string | undefined): ConfigFile | undefined {
  if (!path) return undefined;
  const parsed = readJson(path);
  if (parsed === undefined) return undefined;
  return Schema.decodeUnknownSync(ConfigFile)(parsed, { onExcessProperty: "preserve" });
}

export function configPaths(cwd = process.cwd()) {
  return {
    project: findProjectConfig(cwd),
    user: join(homedir(), ".pi", "agent", "rhizomatic.json"),
    xdg: join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "rhizomatic", "config.json"),
  } as const;
}

export function resolveConfig(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): ResolvedConfig {
  const paths = configPaths(cwd);
  const sources: string[] = [];
  const xdg = loadConfigFile(paths.xdg);
  if (xdg) sources.push(paths.xdg);
  const user = loadConfigFile(paths.user);
  if (user) sources.push(paths.user);
  const project = loadConfigFile(paths.project);
  if (project && paths.project) sources.push(paths.project);

  const merged: ConfigFile = {
    ...xdg,
    ...user,
    ...project,
  };

  const serviceUrl = env.RHIZOMATIC_SERVICE_URL ?? merged.serviceUrl;
  const tokenEnvName = env.RHIZOMATIC_TOKEN_ENV ?? merged.tokenEnv;
  const tokenFromNamedEnv = tokenEnvName ? env[tokenEnvName] : undefined;
  const directToken = env.RHIZOMATIC_TOKEN;
  const token = directToken ?? tokenFromNamedEnv;
  const tokenSource = directToken
    ? "RHIZOMATIC_TOKEN"
    : tokenFromNamedEnv && tokenEnvName
      ? tokenEnvName
      : merged.tokenSecretName
        ? `secret:${merged.tokenSecretName}`
        : undefined;

  if (env.RHIZOMATIC_SERVICE_URL) sources.push("env:RHIZOMATIC_SERVICE_URL");
  if (directToken) sources.push("env:RHIZOMATIC_TOKEN");
  if (tokenFromNamedEnv && tokenEnvName) sources.push(`env:${tokenEnvName}`);

  const backend = env.RHIZOMATIC_BACKEND ?? merged.backend ?? "rhizomatic-http";
  if (backend !== "rhizomatic-http" && backend !== "chorus-http") throw new Error(`Unknown RHIZOMATIC_BACKEND: ${backend}`);

  return {
    serviceUrl,
    backend,
    token,
    tokenSource,
    outboxDir: env.RHIZOMATIC_OUTBOX_DIR ?? merged.outboxDir ?? join(homedir(), ".rhizomatic", "outbox"),
    sessionDir: env.RHIZOMATIC_SESSION_DIR ?? merged.sessionDir ?? join(homedir(), ".rhizomatic", "mcp-sessions"),
    sources,
  };
}

export function notConfiguredMessage(config = resolveConfig()): string {
  const paths = configPaths();
  return [
    "Rhizomatic service is not configured.",
    "Set RHIZOMATIC_SERVICE_URL or create one of:",
    `- ${paths.project ?? "<project>/.pi/rhizomatic.json"}`,
    `- ${paths.user}`,
    `- ${paths.xdg}`,
    "Example: { \"serviceUrl\": \"http://127.0.0.1:4821/mcp\", \"backend\": \"chorus-http\", \"tokenEnv\": \"RHIZOMATIC_TOKEN\" }",
    `Config sources checked: ${config.sources.length ? config.sources.join(", ") : "none"}`,
  ].join("\n");
}

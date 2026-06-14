import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TEMPLATE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "templates");
const DEFAULT_TARGET_DIR = "~/.config/rhizomatic/hooks";
const HOOK_SPECS = [
  { file: "codex-session-start.sh", event: "SessionStart" },
  { file: "codex-stop.sh", event: "Stop" },
] as const;

export interface InstallCodexHooksOptions {
  readonly write?: boolean;
  readonly targetDir?: string;
  readonly packagePath?: string;
}

function packageRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

function expandHome(path: string) {
  if (path === "~") return process.env.HOME ?? path;
  if (path.startsWith("~/")) return resolve(process.env.HOME ?? "", path.slice(2));
  return resolve(path);
}

function escapeForDoubleQuotedShell(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/`/g, "\\`");
}

function shellSingleQuote(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function renderCodexHookTemplate(file: string, packagePath = packageRoot()) {
  const template = readFileSync(resolve(TEMPLATE_DIR, file), "utf8");
  return template.replaceAll("__PI_RHIZOMATIC_PACKAGE__", escapeForDoubleQuotedShell(packagePath));
}

export function installCodexHooks(options: InstallCodexHooksOptions = {}) {
  const targetDir = expandHome(options.targetDir ?? DEFAULT_TARGET_DIR);
  const packagePath = expandHome(options.packagePath ?? packageRoot());
  const files = HOOK_SPECS.map((spec) => {
    const path = resolve(targetDir, spec.file);
    const content = renderCodexHookTemplate(spec.file, packagePath);
    if (options.write) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, "utf8");
      chmodSync(path, 0o755);
    }
    return {
      event: spec.event,
      path,
      bytes: Buffer.byteLength(content),
      command: `bash ${shellSingleQuote(path)}`,
    };
  });

  return {
    ok: true,
    dryRun: !options.write,
    targetDir,
    packagePath,
    files,
    notes: [
      "Writes wrapper scripts only; it does not mutate ~/.codex/hooks.json.",
      "The wrappers fail open with strict Codex JSON so Rhizomatic outages do not block Codex.",
    ],
  };
}

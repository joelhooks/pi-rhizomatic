#!/usr/bin/env tsx
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { RhizomaticClient } from "./client.js";
import { runLocalCanary, runNetworkCanary } from "./canary.js";
import { configPaths, resolveConfig } from "./config.js";
import { readStdinJson, runSessionStartHook, runStopHook, type Runtime } from "./hooks.js";
import { makeOpenApi } from "./openapi.js";
import { startReferenceService } from "./reference-service.js";
import { PrimitiveNames, type PrimitiveName } from "./schema.js";

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function has(flag: string) {
  return process.argv.includes(flag);
}

function print(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function usage() {
  process.stdout.write(`pi-rhizomatic\n\nCommands:\n  init [--write] [--service-url URL] [--token-env NAME]\n  serve [--store PATH] [--host 127.0.0.1] [--port 7331]\n  openapi [--out PATH]\n  health\n  contract\n  call <primitive> [--json '{...}']\n  hook session-start --runtime pi|claude|codex\n  hook stop --runtime pi|claude|codex\n  canary [--local] [--label LABEL]\n  drain\n\n`);
}

async function main() {
  const command = process.argv[2];
  if (!command || command === "--help" || command === "-h") {
    usage();
    return;
  }

  if (command === "openapi") {
    const spec = makeOpenApi();
    const out = arg("--out");
    if (out) {
      const path = resolve(out);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
      print({ ok: true, out: path });
    } else {
      print(spec);
    }
    return;
  }

  if (command === "canary") {
    const label = arg("--label", process.env.RHIZOMATIC_CANARY_LABEL ?? `canary:${Date.now()}`)!;
    if (has("--local")) {
      print(await runLocalCanary(label));
      return;
    }
    const client = RhizomaticClient.fromCwd();
    print(await runNetworkCanary(client, label));
    return;
  }

  if (command === "serve") {
    const storePath = resolve(arg("--store", process.env.RHIZOMATIC_STORE ?? "./rhizomatic.jsonl")!);
    const host = arg("--host", process.env.RHIZOMATIC_HOST ?? "127.0.0.1")!;
    const port = Number(arg("--port", process.env.RHIZOMATIC_PORT ?? "7331"));
    const token = process.env.RHIZOMATIC_TOKEN;
    const service = await startReferenceService({ storePath, host, port, token });
    process.stderr.write(`pi-rhizomatic reference service listening on ${service.url} store=${storePath}\n`);
    await new Promise(() => undefined);
    return;
  }

  if (command === "init") {
    const paths = configPaths();
    const serviceUrl = arg("--service-url", process.env.RHIZOMATIC_SERVICE_URL ?? "http://127.0.0.1:7331");
    const tokenEnv = arg("--token-env", "RHIZOMATIC_TOKEN");
    const target = arg("--config", paths.user);
    const proposed = {
      serviceUrl,
      tokenEnv,
      outboxDir: "~/.rhizomatic/outbox",
    };
    const preview = {
      ok: true,
      dryRun: !has("--write"),
      detected: paths,
      target,
      proposed,
      notes: [
        "No files changed unless --write is passed.",
        "Claude/Codex hook installation is intentionally preview-only in v0; copy commands from the README or private overlays.",
      ],
    };
    if (has("--write") && target) {
      const path = resolve(target.replace(/^~(?=$|\/)/, process.env.HOME ?? ""));
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(proposed, null, 2)}\n`, "utf8");
      print({ ...preview, dryRun: false, wrote: path });
    } else {
      print(preview);
    }
    return;
  }

  const client = RhizomaticClient.fromCwd();

  if (command === "health") {
    print(await client.health());
    return;
  }
  if (command === "contract") {
    print(await client.contract());
    return;
  }
  if (command === "drain") {
    print(await client.drain());
    return;
  }

  if (command === "call") {
    const primitive = process.argv[3] as PrimitiveName | undefined;
    if (!primitive || !PrimitiveNames.includes(primitive)) throw new Error(`Unknown primitive: ${primitive ?? "<missing>"}`);
    const jsonArg = arg("--json", "{}");
    const input = jsonArg === "-" ? readStdinJson() : JSON.parse(jsonArg ?? "{}");
    print(await client.call(primitive, input, { queueOnFailure: has("--queue") }));
    return;
  }

  if (command === "hook") {
    const event = process.argv[3];
    const runtime = arg("--runtime", "other") as Runtime;
    const input = readStdinJson();
    if (event === "session-start") {
      print(await runSessionStartHook(runtime, input));
      return;
    }
    if (event === "stop") {
      print(await runStopHook(runtime, input));
      return;
    }
    throw new Error(`Unknown hook event: ${event ?? "<missing>"}`);
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

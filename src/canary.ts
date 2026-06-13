#!/usr/bin/env tsx
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RhizomaticClient } from "./client.js";
import { startReferenceService } from "./reference-service.js";
import { readEvents } from "./store.js";
import type { Runtime } from "./hooks.js";

const runtimes: Runtime[] = ["pi", "claude", "codex"];

export interface CanaryResult {
  readonly ok: true;
  readonly label: string;
  readonly recallProof: Record<string, number>;
  readonly beginEndProof?: Record<string, { begin: number; end: number }>;
  readonly events?: number;
  readonly storePath?: string;
  readonly serviceUrl?: string;
}

export async function runNetworkCanary(client: RhizomaticClient, label = `canary:${Date.now()}`): Promise<CanaryResult> {
  for (const runtime of runtimes) {
    const runtimeSessionId = `${runtime}:${label}`;
    await client.call("begin-session", { runtime, runtimeSessionId, purpose: `${runtime} ${label}`, idempotencyKey: `${runtimeSessionId}:begin` });
    await client.call("briefing", { runtime, runtimeSessionId });
    await client.call("remember", {
      about: `${label}:${runtime}`,
      attribute: "status",
      value: "seen",
      kind: "canary",
      idempotencyKey: `${runtimeSessionId}:remember`,
    });
    await client.call("end-session", { runtime, runtimeSessionId, summary: `${runtime} ${label} complete`, idempotencyKey: `${runtimeSessionId}:end` });
  }

  const recallProof: Record<string, number> = {};
  for (const runtime of runtimes) {
    const result = await client.call("recall", { query: label });
    const items = (result.data as { items?: unknown[] } | undefined)?.items ?? [];
    recallProof[runtime] = items.length;
    if (items.length < 3) throw new Error(`${runtime} recalled ${items.length} ${label} claims, expected at least 3`);
  }

  return { ok: true, label, recallProof };
}

export async function runLocalCanary(label = "canary:local") {
  const dir = mkdtempSync(join(tmpdir(), "pi-rhizomatic-canary-"));
  const storePath = join(dir, "store.jsonl");
  const service = await startReferenceService({ storePath, host: "127.0.0.1", port: 0 });
  const client = new RhizomaticClient({ serviceUrl: service.url, outboxDir: join(dir, "outbox"), sources: ["canary"] });

  try {
    const result = await runNetworkCanary(client, label);
    const events = readEvents(storePath);
    const beginEndProof: Record<string, { begin: number; end: number }> = {};
    for (const runtime of runtimes) {
      const begin = events.filter((event) => event.type === "begin-session" && event.runtime === runtime).length;
      const end = events.filter((event) => event.type === "end-session" && event.runtime === runtime).length;
      if (begin < 1 || end < 1) throw new Error(`${runtime} missing begin/end events`);
      beginEndProof[runtime] = { begin, end };
    }
    return { ...result, serviceUrl: service.url, storePath, beginEndProof, events: events.length };
  } finally {
    service.close();
    if (!process.env.KEEP_RHIZOMATIC_CANARY) rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("src/canary.ts")) {
  runLocalCanary(process.env.RHIZOMATIC_CANARY_LABEL ?? "canary:local").then((result) => {
    console.log(JSON.stringify(result, null, 2));
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { PrimitiveName } from "./schema.js";

export interface OutboxItem {
  readonly id: string;
  readonly primitive: PrimitiveName;
  readonly input: unknown;
  readonly createdAt: string;
  readonly attempts: number;
  readonly lastError?: string;
}

export function enqueueOutbox(outboxDir: string, primitive: PrimitiveName, input: unknown, error?: unknown): OutboxItem {
  mkdirSync(outboxDir, { recursive: true });
  const item: OutboxItem = {
    id: randomUUID(),
    primitive,
    input,
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastError: error instanceof Error ? error.message : error ? String(error) : undefined,
  };
  writeFileSync(join(outboxDir, `${item.id}.json`), JSON.stringify(item, null, 2), "utf8");
  return item;
}

export function listOutbox(outboxDir: string): OutboxItem[] {
  if (!existsSync(outboxDir)) return [];
  return readdirSync(outboxDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(outboxDir, name), "utf8")) as OutboxItem);
}

export function removeOutboxItem(outboxDir: string, id: string) {
  const path = join(outboxDir, `${id}.json`);
  if (existsSync(path)) unlinkSync(path);
}

export function updateOutboxFailure(outboxDir: string, item: OutboxItem, error: unknown) {
  const next: OutboxItem = {
    ...item,
    attempts: item.attempts + 1,
    lastError: error instanceof Error ? error.message : String(error),
  };
  const path = join(outboxDir, `${item.id}.json`);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
  renameSync(tmp, path);
}

export const MutatingPrimitives = new Set<PrimitiveName>([
  "begin-session",
  "remember",
  "same",
  "retract",
  "revise",
  "recast",
  "end-session",
  "post",
  "ack",
  "decide",
  "trust",
]);

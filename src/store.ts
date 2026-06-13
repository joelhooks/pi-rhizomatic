import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { ContractVersion, type PrimitiveName, type Receipt, validatePrimitiveInput } from "./schema.js";

export interface StoreEvent {
  readonly id: string;
  readonly type: string;
  readonly primitive: PrimitiveName;
  readonly input: Record<string, unknown>;
  readonly sessionId?: string;
  readonly runtime?: string;
  readonly timestamp: string;
  readonly idempotencyKey?: string;
  readonly retracted?: string;
}

export interface StoreState {
  readonly events: readonly StoreEvent[];
  readonly sessions: readonly StoreEvent[];
  readonly claims: readonly StoreEvent[];
  readonly messages: readonly StoreEvent[];
}

export function readEvents(storePath: string): StoreEvent[] {
  const path = resolve(storePath);
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8").trim();
  if (!raw) return [];
  return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line) as StoreEvent);
}

export function appendEvent(storePath: string, event: StoreEvent): StoreEvent {
  const path = resolve(storePath);
  mkdirSync(dirname(path), { recursive: true });
  const existing = event.idempotencyKey
    ? readEvents(path).find((candidate) => candidate.idempotencyKey === event.idempotencyKey)
    : undefined;
  if (existing) return existing;
  appendFileSync(path, `${JSON.stringify(event)}\n`, "utf8");
  return event;
}

export function stateFromEvents(events: readonly StoreEvent[]): StoreState {
  const retracted = new Set(
    events
      .filter((event) => event.type === "retract" && typeof event.input.deltaId === "string")
      .map((event) => event.input.deltaId as string),
  );
  return {
    events,
    sessions: events.filter((event) => event.type === "begin-session" || event.type === "end-session"),
    claims: events.filter((event) => event.type === "claim" && !retracted.has(event.id)),
    messages: events.filter((event) => event.type === "message"),
  };
}

function now() {
  return new Date().toISOString();
}

function receipt(storePath: string, primitive: PrimitiveName, event?: StoreEvent): Receipt {
  return {
    service: "pi-rhizomatic-reference",
    contractVersion: ContractVersion,
    primitive,
    eventId: event?.id,
    sessionId: event?.sessionId,
    runtime: event?.runtime === "pi" || event?.runtime === "claude" || event?.runtime === "codex" || event?.runtime === "other"
      ? event.runtime
      : undefined,
    store: resolve(storePath),
    timestamp: now(),
  };
}

function sessionIdFrom(input: Record<string, unknown>): string | undefined {
  return typeof input.runtimeSessionId === "string"
    ? input.runtimeSessionId
    : typeof input.sessionId === "string"
      ? input.sessionId
      : undefined;
}

function runtimeFrom(input: Record<string, unknown>): string | undefined {
  return typeof input.runtime === "string" ? input.runtime : undefined;
}

function makeEvent(primitive: PrimitiveName, type: string, input: Record<string, unknown>): StoreEvent {
  return {
    id: randomUUID(),
    type,
    primitive,
    input,
    sessionId: sessionIdFrom(input),
    runtime: runtimeFrom(input),
    timestamp: now(),
    idempotencyKey: typeof input.idempotencyKey === "string" ? input.idempotencyKey : undefined,
  };
}

function textIncludes(value: unknown, query: string): boolean {
  return JSON.stringify(value).toLowerCase().includes(query.toLowerCase());
}

export function executePrimitive(storePath: string, primitive: PrimitiveName, rawInput: unknown) {
  const input = validatePrimitiveInput(primitive, rawInput);
  const events = readEvents(storePath);
  const state = stateFromEvents(events);

  switch (primitive) {
    case "begin-session": {
      const event = appendEvent(storePath, makeEvent(primitive, "begin-session", input));
      return { ok: true, data: { sessionId: event.sessionId ?? event.id, event }, receipt: receipt(storePath, primitive, event) };
    }
    case "end-session": {
      const event = appendEvent(storePath, makeEvent(primitive, "end-session", input));
      return { ok: true, data: { event }, receipt: receipt(storePath, primitive, event) };
    }
    case "remember": {
      const event = appendEvent(storePath, makeEvent(primitive, "claim", input));
      return { ok: true, data: { deltaId: event.id, event }, receipt: receipt(storePath, primitive, event) };
    }
    case "recall": {
      const about = typeof input.about === "string" ? input.about : undefined;
      const attribute = typeof input.attribute === "string" ? input.attribute : undefined;
      const query = typeof input.query === "string" ? input.query : undefined;
      const items = state.claims.filter((event) => {
        if (about && event.input.about !== about) return false;
        if (attribute && event.input.attribute !== attribute) return false;
        if (query && !textIncludes(event.input, query)) return false;
        return true;
      });
      return { ok: true, data: { items, count: items.length }, receipt: receipt(storePath, primitive) };
    }
    case "briefing": {
      const recentSessions = state.sessions.slice(-8);
      const recentClaims = state.claims.slice(-12);
      return {
        ok: true,
        data: { recentSessions, recentClaims, contested: [], inbox: [], contestedElsewhere: 0 },
        receipt: receipt(storePath, primitive),
      };
    }
    case "whoami":
      return { ok: true, data: { runtime: input.runtime ?? "unknown", sessionId: input.sessionId ?? input.runtimeSessionId }, receipt: receipt(storePath, primitive) };
    case "topics": {
      const topics = Array.from(new Set(state.claims.map((event) => event.input.about).filter((v): v is string => typeof v === "string"))).sort();
      return { ok: true, data: { topics }, receipt: receipt(storePath, primitive) };
    }
    case "search": {
      const query = typeof input.query === "string" ? input.query : "";
      const items = query ? state.claims.filter((event) => textIncludes(event.input, query)) : state.claims.slice(-20);
      return { ok: true, data: { items, count: items.length }, receipt: receipt(storePath, primitive) };
    }
    case "post": {
      const event = appendEvent(storePath, makeEvent(primitive, "message", input));
      return { ok: true, data: { messageId: event.id, event }, receipt: receipt(storePath, primitive, event) };
    }
    case "inbox":
      return { ok: true, data: { messages: state.messages }, receipt: receipt(storePath, primitive) };
    case "ack": {
      const event = appendEvent(storePath, makeEvent(primitive, "ack", input));
      return { ok: true, data: { event }, receipt: receipt(storePath, primitive, event) };
    }
    case "retract": {
      const event = appendEvent(storePath, makeEvent(primitive, "retract", input));
      return { ok: true, data: { event }, receipt: receipt(storePath, primitive, event) };
    }
    case "revise":
    case "recast":
    case "same":
    case "trust":
    case "decide":
    case "replay":
    case "explain":
    case "as-of": {
      const event = appendEvent(storePath, makeEvent(primitive, primitive, input));
      return { ok: true, data: { event, note: "Reference service records this primitive; hardened implementations may add richer semantics." }, receipt: receipt(storePath, primitive, event) };
    }
  }
}

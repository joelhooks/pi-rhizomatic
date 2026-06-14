import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { PrimitiveName, ToolResponse } from "./schema.js";
import type { ResolvedConfig } from "./config.js";

interface RpcResponse {
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
}

interface SessionCache {
  readonly serviceUrl: string;
  readonly mcpSessionId: string;
  readonly updatedAt: string;
}

let rpcId = 1;

function jsonRpc(method: string, params: Record<string, unknown> = {}) {
  return { jsonrpc: "2.0", id: rpcId++, method, params };
}

function notification(method: string) {
  return { jsonrpc: "2.0", method };
}

function cacheKey(serviceUrl: string, runtimeSessionId: string) {
  return createHash("sha256").update(`${serviceUrl}\n${runtimeSessionId}`).digest("hex");
}

function cachePath(config: ResolvedConfig, runtimeSessionId: string) {
  return join(config.sessionDir, `${cacheKey(config.serviceUrl ?? "", runtimeSessionId)}.json`);
}

function readCache(config: ResolvedConfig, runtimeSessionId: string): SessionCache | undefined {
  const path = cachePath(config, runtimeSessionId);
  if (!existsSync(path)) return undefined;
  try {
    const cache = JSON.parse(readFileSync(path, "utf8")) as SessionCache;
    return cache.serviceUrl === config.serviceUrl ? cache : undefined;
  } catch {
    return undefined;
  }
}

function writeCache(config: ResolvedConfig, runtimeSessionId: string, mcpSessionId: string) {
  const path = cachePath(config, runtimeSessionId);
  mkdirSync(config.sessionDir, { recursive: true });
  writeFileSync(path, `${JSON.stringify({ serviceUrl: config.serviceUrl, mcpSessionId, updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
}

function runtimeSessionIdFrom(input: Record<string, unknown>) {
  const raw = input.runtimeSessionId ?? input.sessionId ?? input.conversation_id ?? input.cwd ?? "default";
  return String(raw);
}

function headers(config: ResolvedConfig, mcpSessionId?: string) {
  return {
    "content-type": "application/json",
    ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
    ...(mcpSessionId ? { "mcp-session-id": mcpSessionId } : {}),
  };
}

async function postRpc(config: ResolvedConfig, body: unknown, mcpSessionId?: string) {
  if (!config.serviceUrl) throw new Error("Chorus HTTP adapter requires serviceUrl");
  const response = await fetch(config.serviceUrl, {
    method: "POST",
    headers: headers(config, mcpSessionId),
    body: JSON.stringify(body),
  });
  if (response.status === 202) return { response, json: undefined as RpcResponse | undefined };
  const text = await response.text();
  const json = text.trim() ? (JSON.parse(text) as RpcResponse) : undefined;
  if (!response.ok) {
    throw new Error(json?.error?.message ?? `Chorus HTTP ${response.status}`);
  }
  if (json?.error) throw new Error(json.error.message);
  return { response, json };
}

async function initialize(config: ResolvedConfig, runtimeSessionId: string) {
  const { response } = await postRpc(config, jsonRpc("initialize", { protocolVersion: "2025-03-26", clientInfo: { name: "pi-rhizomatic", version: "0.1.0" } }));
  const mcpSessionId = response.headers.get("mcp-session-id");
  if (!mcpSessionId) throw new Error("Chorus HTTP did not return Mcp-Session-Id");
  await postRpc(config, notification("notifications/initialized"), mcpSessionId);
  writeCache(config, runtimeSessionId, mcpSessionId);
  return mcpSessionId;
}

async function sessionId(config: ResolvedConfig, runtimeSessionId: string) {
  return readCache(config, runtimeSessionId)?.mcpSessionId ?? initialize(config, runtimeSessionId);
}

function normalizeKind(kind: unknown) {
  if (kind === "observation" || kind === "fact" || kind === "preference" || kind === "task") return kind;
  if (kind === "canary" || kind === "summary") return "fact";
  return undefined;
}

function stripUndefined<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as T;
}

function toChorusTool(primitive: PrimitiveName, rawInput: unknown): { tool: string; args: Record<string, unknown>; normalize?: (result: unknown) => unknown } {
  const input = (rawInput && typeof rawInput === "object" && !Array.isArray(rawInput) ? rawInput : {}) as Record<string, unknown>;
  switch (primitive) {
    case "begin-session":
      return {
        tool: "begin-session",
        args: stripUndefined({
          model: typeof input.model === "string" ? input.model : typeof input.runtime === "string" ? input.runtime : "unknown",
          purpose: input.purpose,
          topics: input.topics,
          surface: input.surface ?? input.runtime,
          mode: input.mode,
        }),
      };
    case "remember":
      return {
        tool: "remember",
        args: stripUndefined({
          about: input.about,
          attribute: input.attribute,
          value: input.value,
          kind: normalizeKind(input.kind),
          confidence: input.confidence,
          source: input.source,
          speaker: input.speaker,
        }),
      };
    case "recall": {
      const entity = input.entity ?? input.about;
      if (typeof entity === "string") {
        return {
          tool: "recall",
          args: stripUndefined({ entity, attribute: input.attribute, aliasedVia: input.aliasedVia, unified: input.unified, all: input.all }),
        };
      }
      return {
        tool: "search",
        args: stripUndefined({ query: typeof input.query === "string" ? input.query : "", limit: input.limit }),
        normalize: (result) => ({ items: Array.isArray(result) ? result : [], count: Array.isArray(result) ? result.length : 0 }),
      };
    }
    case "end-session":
      return { tool: "end-session", args: { summary: typeof input.summary === "string" ? input.summary : "Automatic session end" } };
    case "whoami":
    case "briefing":
    case "topics":
    case "search":
    case "same":
    case "retract":
    case "revise":
    case "recast":
    case "post":
    case "inbox":
    case "ack":
    case "decide":
    case "replay":
    case "explain":
    case "trust":
    case "as-of":
      return { tool: primitive, args: input };
  }
}

function responseFrom(primitive: PrimitiveName, data: unknown): ToolResponse {
  return {
    ok: true,
    data,
    receipt: {
      service: "chorus-mcp-http-adapter",
      contractVersion: "0.1.0",
      primitive,
      timestamp: new Date().toISOString(),
    },
  };
}

export async function chorusHealth(config: ResolvedConfig) {
  if (!config.serviceUrl) throw new Error("Chorus HTTP adapter requires serviceUrl");
  const response = await fetch(config.serviceUrl, { method: "HEAD", headers: headers(config) });
  return { ok: response.ok, service: "chorus-mcp-http", backend: "chorus-http", status: response.status, endpoint: config.serviceUrl };
}

export async function chorusContract(config: ResolvedConfig) {
  const runtimeSessionId = "contract";
  const mcpSessionId = await sessionId(config, runtimeSessionId);
  const { json } = await postRpc(config, jsonRpc("tools/list", {}), mcpSessionId);
  const result = json?.result as { tools?: Array<{ name?: string }> } | undefined;
  return { name: "chorus-mcp-http", backend: "chorus-http", capabilities: result?.tools?.map((tool) => tool.name).filter(Boolean) ?? [], tools: result?.tools ?? [] };
}

export async function chorusCall(config: ResolvedConfig, primitive: PrimitiveName, input: unknown = {}): Promise<ToolResponse> {
  const runtimeSessionId = runtimeSessionIdFrom((input && typeof input === "object" && !Array.isArray(input) ? input : {}) as Record<string, unknown>);
  const mapped = toChorusTool(primitive, input);
  let mcpSessionId = await sessionId(config, runtimeSessionId);
  const body = () => jsonRpc("tools/call", { name: mapped.tool, arguments: mapped.args });
  try {
    const { json } = await postRpc(config, body(), mcpSessionId);
    const result = parseToolResult(json, mapped.tool);
    return responseFrom(primitive, mapped.normalize ? mapped.normalize(result) : result);
  } catch (error) {
    if (String(error instanceof Error ? error.message : error).includes("unknown or expired session")) {
      mcpSessionId = await initialize(config, runtimeSessionId);
      const { json } = await postRpc(config, body(), mcpSessionId);
      const result = parseToolResult(json, mapped.tool);
      return responseFrom(primitive, mapped.normalize ? mapped.normalize(result) : result);
    }
    throw error;
  }
}

function parseToolResult(json: RpcResponse | undefined, tool: string) {
  const result = json?.result as { content?: Array<{ text?: string }>; isError?: boolean } | undefined;
  const text = result?.content?.[0]?.text ?? "null";
  if (result?.isError) throw new Error(`Chorus ${tool}: ${text}`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

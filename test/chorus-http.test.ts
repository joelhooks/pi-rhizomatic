import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RhizomaticClient } from "../src/client.js";

const servers: Array<{ close: () => void }> = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

async function readBody(req: IncomingMessage) {
  let body = "";
  for await (const chunk of req) body += chunk.toString();
  return body ? JSON.parse(body) : {};
}

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

async function fakeChorusServer() {
  const calls: Array<{ name: string; args: Record<string, unknown>; session?: string }> = [];
  let sessionCounter = 0;
  const server = createServer(async (req, res) => {
    if (req.method === "HEAD") {
      send(res, 200);
      return;
    }
    if (req.method !== "POST") {
      send(res, 405);
      return;
    }
    const rpc = await readBody(req);
    if (rpc.method === "initialize") {
      const mcpSessionId = `session-${++sessionCounter}`;
      send(res, 200, rpcResult(rpc.id, { protocolVersion: rpc.params?.protocolVersion, capabilities: { tools: {} } }), { "mcp-session-id": mcpSessionId });
      return;
    }
    if (rpc.method === "notifications/initialized") {
      send(res, 202);
      return;
    }
    if (!req.headers["mcp-session-id"]) {
      send(res, 404, { jsonrpc: "2.0", id: rpc.id ?? null, error: { code: -32001, message: "unknown or expired session — re-initialize" } });
      return;
    }
    if (rpc.method === "tools/list") {
      send(res, 200, rpcResult(rpc.id, { tools: [{ name: "begin-session" }, { name: "remember" }, { name: "search" }] }));
      return;
    }
    if (rpc.method === "tools/call") {
      const name = rpc.params.name;
      const args = rpc.params.arguments ?? {};
      calls.push({ name, args, session: String(req.headers["mcp-session-id"]) });
      const result = name === "search" ? [{ entity: "canary:pi", attribute: "status", value: "seen" }] : { ok: true, name, args };
      send(res, 200, rpcResult(rpc.id, { content: [{ type: "text", text: JSON.stringify(result) }] }));
      return;
    }
    send(res, 404);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push({ close: () => server.close() });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  return { url: `http://127.0.0.1:${address.port}/mcp`, calls };
}

describe("Chorus HTTP adapter", () => {
  it("speaks streamable MCP HTTP without vendoring Chorus", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-rhizomatic-chorus-test-"));
    try {
      const server = await fakeChorusServer();
      const client = new RhizomaticClient({
        serviceUrl: server.url,
        backend: "chorus-http",
        outboxDir: join(dir, "outbox"),
        sessionDir: join(dir, "sessions"),
        sources: ["test"],
      });

      await expect(client.health()).resolves.toMatchObject({ ok: true, service: "chorus-mcp-http" });
      await expect(client.contract()).resolves.toMatchObject({ capabilities: ["begin-session", "remember", "search"] });
      await client.call("begin-session", { runtime: "pi", runtimeSessionId: "pi:test", purpose: "probe" });
      await client.call("remember", { runtimeSessionId: "pi:test", about: "canary:pi", attribute: "status", value: "seen", kind: "canary" });
      const recall = await client.call("recall", { runtimeSessionId: "pi:test", query: "canary" });

      expect(recall.data).toEqual({ items: [{ entity: "canary:pi", attribute: "status", value: "seen" }], count: 1 });
      expect(server.calls.map((call) => call.name)).toEqual(["begin-session", "remember", "search"]);
      expect(new Set(server.calls.map((call) => call.session)).size).toBe(1);
      expect(server.calls[1]?.args.kind).toBe("fact");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

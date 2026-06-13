import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { PrimitiveNames, type PrimitiveName } from "./schema.js";
import { makeOpenApi } from "./openapi.js";
import { executePrimitive } from "./store.js";

export interface ServeOptions {
  readonly storePath: string;
  readonly host: string;
  readonly port: number;
  readonly token?: string;
}

const primitiveSet = new Set<string>(PrimitiveNames);

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function authorized(req: IncomingMessage, token?: string): boolean {
  if (!token) return true;
  return req.headers.authorization === `Bearer ${token}`;
}

export function startReferenceService(options: ServeOptions) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, { ok: true, service: "pi-rhizomatic-reference", store: options.storePath });
        return;
      }
      if (req.method === "GET" && url.pathname === "/openapi.json") {
        sendJson(res, 200, makeOpenApi());
        return;
      }
      if (req.method === "GET" && url.pathname === "/contract") {
        sendJson(res, 200, {
          name: "rhizomatic-service-contract",
          version: makeOpenApi().info.version,
          capabilities: PrimitiveNames,
          openapi: "/openapi.json",
        });
        return;
      }

      if (!authorized(req, options.token)) {
        sendJson(res, 401, { ok: false, error: { code: "unauthorized", message: "Invalid bearer token" } });
        return;
      }

      const match = url.pathname.match(/^\/v0\/tools\/([^/]+)$/);
      if (req.method === "POST" && match) {
        const primitive = decodeURIComponent(match[1] ?? "");
        if (!primitiveSet.has(primitive)) {
          sendJson(res, 404, { ok: false, error: { code: "unknown_primitive", message: `Unknown primitive: ${primitive}` } });
          return;
        }
        const input = await readBody(req);
        const result = executePrimitive(options.storePath, primitive as PrimitiveName, input);
        sendJson(res, 200, result);
        return;
      }

      sendJson(res, 404, { ok: false, error: { code: "not_found", message: `${req.method ?? "GET"} ${url.pathname}` } });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: {
          code: "server_error",
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  });

  return new Promise<{ readonly close: () => void; readonly url: string }>((resolve) => {
    server.listen(options.port, options.host, () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : options.port;
      resolve({ close: () => server.close(), url: `http://${options.host}:${port}` });
    });
  });
}

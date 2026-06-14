import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { RhizomaticClient, primitiveFromToolName, toolNameFromPrimitive } from "../src/client.js";
import { notConfiguredMessage } from "../src/config.js";
import { PrimitiveNames, type PrimitiveName } from "../src/schema.js";

const AnyObject = Type.Record(Type.String(), Type.Any());

function summarize(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.length > 4000 ? `${text.slice(0, 4000)}\n…truncated` : text;
}

function parseCommand(args: string): { command: string; rest: string } {
  const trimmed = args.trim();
  if (!trimmed) return { command: "status", rest: "" };
  const [command = "status", ...rest] = trimmed.split(/\s+/);
  return { command, rest: rest.join(" ") };
}

export default function piRhizomatic(pi: ExtensionAPI) {
  let lifecycleStarted = false;
  let currentRuntimeSessionId: string | undefined;

  for (const primitive of PrimitiveNames) {
    pi.registerTool({
      name: toolNameFromPrimitive(primitive),
      label: `Rhizomatic ${primitive}`,
      description: `Execute Rhizomatic primitive ${primitive} through the configured service endpoint.`,
      promptSnippet: `Use ${toolNameFromPrimitive(primitive)} for Rhizomatic memory primitive ${primitive}.`,
      parameters: AnyObject,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const client = RhizomaticClient.fromCwd(ctx.cwd);
        const toolPrimitive = primitiveFromToolName(toolNameFromPrimitive(primitive));
        if (!toolPrimitive) throw new Error(`Unknown Rhizomatic tool: ${primitive}`);
        const runtimeParams = currentRuntimeSessionId && !("runtimeSessionId" in params)
          ? { runtime: "pi", runtimeSessionId: currentRuntimeSessionId, ...params }
          : params;
        const result = await client.call(toolPrimitive, runtimeParams, { queueOnFailure: true });
        return {
          content: [{ type: "text", text: summarize(result) }],
          details: { primitive: toolPrimitive, ok: result.ok, receipt: result.receipt },
        };
      },
    });
  }

  pi.registerCommand("rhizomatic", {
    description: "Status, briefing, drain, or call Rhizomatic memory",
    getArgumentCompletions: (prefix) => {
      const commands = ["status", "briefing", "drain", "contract", "call"];
      const filtered = commands.filter((command) => command.startsWith(prefix));
      return filtered.length ? filtered.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const { command, rest } = parseCommand(args);
      const client = RhizomaticClient.fromCwd(ctx.cwd);
      try {
        if (command === "status") {
          if (!client.config.serviceUrl) {
            pi.sendMessage({ customType: "rhizomatic", content: notConfiguredMessage(client.config), display: true, details: { configured: false } });
            return;
          }
          const health = await client.health();
          pi.sendMessage({ customType: "rhizomatic", content: summarize(health), display: true, details: { configured: true } });
          return;
        }
        if (command === "briefing") {
          const result = await client.call("briefing", {});
          pi.sendMessage({ customType: "rhizomatic", content: summarize(result.data), display: true, details: { primitive: "briefing" } });
          return;
        }
        if (command === "contract") {
          const result = await client.contract();
          pi.sendMessage({ customType: "rhizomatic", content: summarize(result), display: true, details: { command: "contract" } });
          return;
        }
        if (command === "drain") {
          const result = await client.drain();
          pi.sendMessage({ customType: "rhizomatic", content: summarize(result), display: true, details: { command: "drain" } });
          return;
        }
        if (command === "call") {
          const [primitiveRaw = "briefing", ...jsonParts] = rest.split(/\s+/);
          const primitive = primitiveRaw as PrimitiveName;
          const input = jsonParts.length ? JSON.parse(jsonParts.join(" ")) : {};
          const result = await client.call(primitive, input, { queueOnFailure: true });
          pi.sendMessage({ customType: "rhizomatic", content: summarize(result), display: true, details: { primitive } });
          return;
        }
        pi.sendMessage({ customType: "rhizomatic", content: `Unknown /rhizomatic command: ${command}`, display: true, details: { command } });
      } catch (error) {
        pi.sendMessage({ customType: "rhizomatic", content: error instanceof Error ? error.message : String(error), display: true, details: { command, error: true } });
      }
    },
  });

  pi.on("session_start", () => {
    lifecycleStarted = false;
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (lifecycleStarted) return { systemPrompt: event.systemPrompt };
    lifecycleStarted = true;
    const client = RhizomaticClient.fromCwd(ctx.cwd);
    if (!client.config.serviceUrl) return { systemPrompt: event.systemPrompt };

    const runtimeSessionId = `pi:${ctx.sessionManager?.getSessionId?.() ?? Date.now()}`;
    currentRuntimeSessionId = runtimeSessionId;
    try {
      await client.call(
        "begin-session",
        {
          runtime: "pi",
          runtimeSessionId,
          cwd: ctx.cwd,
          surface: "pi",
          purpose: "Automatic Pi session start",
          idempotencyKey: `${runtimeSessionId}:session-start`,
        },
        { queueOnFailure: true },
      );
      const briefing = await client.call("briefing", { runtime: "pi", runtimeSessionId });
      return {
        systemPrompt: `${event.systemPrompt}\n\n<RhizomaticBriefing>\n${summarize(briefing.data)}\n</RhizomaticBriefing>`,
      };
    } catch {
      return { systemPrompt: event.systemPrompt };
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (!currentRuntimeSessionId) return;
    const client = RhizomaticClient.fromCwd(ctx.cwd);
    await client.call(
      "end-session",
      {
        runtime: "pi",
        runtimeSessionId: currentRuntimeSessionId,
        summary: "Automatic Pi session shutdown",
        idempotencyKey: `${currentRuntimeSessionId}:session-shutdown`,
      },
      { queueOnFailure: true },
    ).catch(() => undefined);
  });
}

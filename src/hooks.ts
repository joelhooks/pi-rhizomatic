import { readFileSync } from "node:fs";
import { RhizomaticClient } from "./client.js";

export type Runtime = "pi" | "claude" | "codex" | "other";

function stableSessionId(runtime: Runtime, hookInput: Record<string, unknown>) {
  const raw = hookInput.session_id ?? hookInput.sessionId ?? hookInput.conversation_id ?? hookInput.cwd ?? process.pid;
  return `${runtime}:${String(raw)}`;
}

export function readStdinJson(): Record<string, unknown> {
  try {
    const raw = readFileSync(0, "utf8");
    return raw.trim() ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function runSessionStartHook(runtime: Runtime, hookInput: Record<string, unknown>) {
  const client = RhizomaticClient.fromCwd(typeof hookInput.cwd === "string" ? hookInput.cwd : process.cwd());
  const runtimeSessionId = stableSessionId(runtime, hookInput);
  const idempotencyKey = `${runtimeSessionId}:session-start`;
  const begin = await client.call(
    "begin-session",
    {
      runtime,
      runtimeSessionId,
      cwd: hookInput.cwd,
      model: hookInput.model,
      surface: runtime,
      purpose: `Automatic ${runtime} session start`,
      idempotencyKey,
    },
    { queueOnFailure: true },
  );

  let briefingText = "Rhizomatic briefing unavailable.";
  try {
    const briefing = await client.call("briefing", { runtime, runtimeSessionId });
    briefingText = JSON.stringify(briefing.data ?? {}, null, 2);
  } catch (error) {
    briefingText = `Rhizomatic briefing unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }

  return {
    ok: begin.ok,
    runtime,
    runtimeSessionId,
    rhizomatic: { begin, briefing: briefingText },
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: `Rhizomatic briefing:\n${briefingText}`,
    },
  };
}

export async function runStopHook(runtime: Runtime, hookInput: Record<string, unknown>) {
  const client = RhizomaticClient.fromCwd(typeof hookInput.cwd === "string" ? hookInput.cwd : process.cwd());
  const runtimeSessionId = stableSessionId(runtime, hookInput);
  const summary = typeof hookInput.summary === "string" ? hookInput.summary : `Automatic ${runtime} session end`;
  const result = await client.call(
    "end-session",
    {
      runtime,
      runtimeSessionId,
      summary,
      idempotencyKey: `${runtimeSessionId}:stop`,
    },
    { queueOnFailure: true },
  );
  return { ok: result.ok, runtime, runtimeSessionId, rhizomatic: result };
}

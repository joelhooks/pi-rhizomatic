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

export interface SessionStartHookOutput {
  readonly hookSpecificOutput: {
    readonly hookEventName: "SessionStart";
    readonly additionalContext: string;
  };
}

export interface StopHookOutput {
  readonly continue?: boolean;
  readonly stopReason?: string;
  readonly suppressOutput?: boolean;
  readonly systemMessage?: string;
  readonly decision?: "block";
  readonly reason?: string;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function runSessionStartHook(runtime: Runtime, hookInput: Record<string, unknown>): Promise<SessionStartHookOutput> {
  let briefingText = "Rhizomatic briefing unavailable.";

  try {
    const client = RhizomaticClient.fromCwd(typeof hookInput.cwd === "string" ? hookInput.cwd : process.cwd());
    const runtimeSessionId = stableSessionId(runtime, hookInput);
    const idempotencyKey = `${runtimeSessionId}:session-start`;
    await client.call(
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

    try {
      const briefing = await client.call("briefing", { runtime, runtimeSessionId });
      briefingText = JSON.stringify(briefing.data ?? {}, null, 2);
    } catch (error) {
      briefingText = `Rhizomatic briefing unavailable: ${errorMessage(error)}`;
    }
  } catch (error) {
    briefingText = `Rhizomatic briefing unavailable: ${errorMessage(error)}`;
  }

  return {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: `Rhizomatic briefing:\n${briefingText}`,
    },
  };
}

export async function runStopHook(runtime: Runtime, hookInput: Record<string, unknown>): Promise<StopHookOutput> {
  try {
    const client = RhizomaticClient.fromCwd(typeof hookInput.cwd === "string" ? hookInput.cwd : process.cwd());
    const runtimeSessionId = stableSessionId(runtime, hookInput);
    const summary = typeof hookInput.summary === "string" ? hookInput.summary : `Automatic ${runtime} session end`;
    await client.call(
      "end-session",
      {
        runtime,
        runtimeSessionId,
        summary,
        idempotencyKey: `${runtimeSessionId}:stop`,
      },
      { queueOnFailure: true },
    );
  } catch {
    // Codex rejects unknown Stop fields and treats non-zero hook exits as hook failures.
    // Preserve the host runtime's happy path; Rhizomatic diagnostics belong in stderr/logs, not hook JSON.
  }

  return {};
}

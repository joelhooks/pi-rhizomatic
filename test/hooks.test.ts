import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runSessionStartHook, runStopHook } from "../src/hooks.js";

function withIsolatedRhizomaticEnv<T>(fn: (dir: string) => Promise<T>) {
  const dir = mkdtempSync(join(tmpdir(), "pi-rhizomatic-hooks-test-"));
  const previous = {
    RHIZOMATIC_SERVICE_URL: process.env.RHIZOMATIC_SERVICE_URL,
    RHIZOMATIC_OUTBOX_DIR: process.env.RHIZOMATIC_OUTBOX_DIR,
    RHIZOMATIC_SESSION_DIR: process.env.RHIZOMATIC_SESSION_DIR,
  };

  process.env.RHIZOMATIC_SERVICE_URL = "";
  process.env.RHIZOMATIC_OUTBOX_DIR = join(dir, "outbox");
  process.env.RHIZOMATIC_SESSION_DIR = join(dir, "sessions");

  return fn(dir).finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  });
}

describe("runtime hooks", () => {
  it("emits strict SessionStart hook JSON for Codex", async () => {
    await withIsolatedRhizomaticEnv(async () => {
      const output = await runSessionStartHook("codex", { session_id: "test-session", cwd: process.cwd(), model: "gpt-5.5" });
      const json = JSON.parse(JSON.stringify(output));

      expect(Object.keys(json)).toEqual(["hookSpecificOutput"]);
      expect(json.hookSpecificOutput).toEqual({
        hookEventName: "SessionStart",
        additionalContext: expect.stringContaining("Rhizomatic briefing:"),
      });
      expect(json).not.toHaveProperty("ok");
      expect(json).not.toHaveProperty("runtime");
      expect(json).not.toHaveProperty("rhizomatic");
    });
  });

  it("emits strict Stop hook JSON for Codex", async () => {
    await withIsolatedRhizomaticEnv(async () => {
      await expect(runStopHook("codex", { session_id: "test-session", cwd: process.cwd() })).resolves.toEqual({});
    });
  });
});

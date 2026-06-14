import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installCodexHooks, renderCodexHookTemplate } from "../src/codex-install.js";

describe("Codex hook installer", () => {
  it("renders package-owned fail-open wrappers", () => {
    const sessionStart = renderCodexHookTemplate("codex-session-start.sh", "/tmp/pi-rhizomatic");
    const stop = renderCodexHookTemplate("codex-stop.sh", "/tmp/pi-rhizomatic");

    expect(sessionStart).toContain('PACKAGE="${PI_RHIZOMATIC_PACKAGE:-/tmp/pi-rhizomatic}"');
    expect(sessionStart).toContain('"hookEventName":"SessionStart"');
    expect(sessionStart).not.toContain("__PI_RHIZOMATIC_PACKAGE__");
    expect(stop).toContain("printf '%s\\n' '{}'");
    expect(stop).not.toContain("__PI_RHIZOMATIC_PACKAGE__");
  });

  it("writes executable wrapper scripts when requested", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-rhizomatic-codex-install-test-"));
    try {
      const dryRun = installCodexHooks({ targetDir: dir, packagePath: "/tmp/pi-rhizomatic" });
      expect(dryRun.dryRun).toBe(true);
      expect(existsSync(join(dir, "codex-session-start.sh"))).toBe(false);

      const result = installCodexHooks({ write: true, targetDir: dir, packagePath: "/tmp/pi-rhizomatic" });
      expect(result.dryRun).toBe(false);
      for (const file of result.files) {
        expect(existsSync(file.path)).toBe(true);
        expect(statSync(file.path).mode & 0o111).not.toBe(0);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

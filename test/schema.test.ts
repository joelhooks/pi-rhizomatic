import { describe, expect, it } from "vitest";
import { makeOpenApi } from "../src/openapi.js";
import { PrimitiveNames, validatePrimitiveInput } from "../src/schema.js";
import { executePrimitive, readEvents } from "../src/store.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("contract", () => {
  it("generates OpenAPI paths for every primitive", () => {
    const spec = makeOpenApi() as any;
    for (const primitive of PrimitiveNames) {
      expect(spec.paths[`/v0/tools/${primitive}`]).toBeTruthy();
    }
  });

  it("validates known primitive input", () => {
    const input = validatePrimitiveInput("remember", {
      about: "canary:pi",
      attribute: "status",
      value: "seen",
      kind: "canary",
    });
    expect(input.about).toBe("canary:pi");
  });
});

describe("reference store", () => {
  it("records and recalls canary claims", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-rhizomatic-"));
    const store = join(dir, "store.jsonl");
    try {
      executePrimitive(store, "begin-session", { runtime: "pi", runtimeSessionId: "pi:test" });
      executePrimitive(store, "remember", { about: "canary:pi", attribute: "status", value: "seen", kind: "canary" });
      executePrimitive(store, "end-session", { runtime: "pi", runtimeSessionId: "pi:test", summary: "done" });
      const recall = executePrimitive(store, "recall", { query: "canary" }) as any;
      expect(recall.ok).toBe(true);
      expect(recall.data.count).toBe(1);
      expect(readEvents(store).length).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

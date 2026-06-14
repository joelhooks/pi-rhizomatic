import { chorusCall, chorusContract, chorusHealth } from "./chorus-http.js";
import { notConfiguredMessage, resolveConfig, type ResolvedConfig } from "./config.js";
import { MutatingPrimitives, enqueueOutbox, listOutbox, removeOutboxItem, updateOutboxFailure } from "./outbox.js";
import { PrimitiveNames, type PrimitiveName, validateToolResponse, type ToolResponse } from "./schema.js";

export class RhizomaticNotConfiguredError extends Error {
  constructor(message = notConfiguredMessage()) {
    super(message);
    this.name = "RhizomaticNotConfiguredError";
  }
}

export interface CallOptions {
  readonly queueOnFailure?: boolean;
}

export class RhizomaticClient {
  constructor(readonly config: ResolvedConfig) {}

  static fromCwd(cwd = process.cwd()) {
    return new RhizomaticClient(resolveConfig(cwd));
  }

  get configured() {
    return typeof this.config.serviceUrl === "string" && this.config.serviceUrl.length > 0;
  }

  async health() {
    if (!this.config.serviceUrl) throw new RhizomaticNotConfiguredError(notConfiguredMessage(this.config));
    if (this.config.backend === "chorus-http") return chorusHealth(this.config);
    const response = await fetch(new URL("/health", this.config.serviceUrl));
    return response.json();
  }

  async contract() {
    if (!this.config.serviceUrl) throw new RhizomaticNotConfiguredError(notConfiguredMessage(this.config));
    if (this.config.backend === "chorus-http") return chorusContract(this.config);
    const response = await fetch(new URL("/contract", this.config.serviceUrl));
    return response.json();
  }

  async call(primitive: PrimitiveName, input: unknown = {}, options: CallOptions = {}): Promise<ToolResponse> {
    if (!PrimitiveNames.includes(primitive)) {
      throw new Error(`Unknown primitive: ${primitive}`);
    }
    if (!this.config.serviceUrl) {
      const error = new RhizomaticNotConfiguredError(notConfiguredMessage(this.config));
      if (options.queueOnFailure && MutatingPrimitives.has(primitive)) {
        const item = enqueueOutbox(this.config.outboxDir, primitive, input, error);
        return {
          ok: false,
          data: { queued: true, outboxItem: item },
          error: { code: "not_configured_queued", message: error.message },
        };
      }
      throw error;
    }

    try {
      if (this.config.backend === "chorus-http") return await chorusCall(this.config, primitive, input);

      const url = new URL(`/v0/tools/${primitive}`, this.config.serviceUrl);
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.config.token ? { authorization: `Bearer ${this.config.token}` } : {}),
        },
        body: JSON.stringify(input ?? {}),
      });
      const json = await response.json();
      const toolResponse = validateToolResponse(json);
      if (!response.ok || !toolResponse.ok) {
        const message = toolResponse.error?.message ?? `HTTP ${response.status}`;
        throw new Error(message);
      }
      return toolResponse;
    } catch (error) {
      if (options.queueOnFailure && MutatingPrimitives.has(primitive)) {
        const item = enqueueOutbox(this.config.outboxDir, primitive, input, error);
        return {
          ok: false,
          data: { queued: true, outboxItem: item },
          error: { code: "queued_after_failure", message: error instanceof Error ? error.message : String(error) },
        };
      }
      throw error;
    }
  }

  async drain() {
    const items = listOutbox(this.config.outboxDir);
    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    for (const item of items) {
      try {
        await this.call(item.primitive, item.input, { queueOnFailure: false });
        removeOutboxItem(this.config.outboxDir, item.id);
        results.push({ id: item.id, ok: true });
      } catch (error) {
        updateOutboxFailure(this.config.outboxDir, item, error);
        results.push({ id: item.id, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { outboxDir: this.config.outboxDir, results };
  }
}

export function primitiveFromToolName(toolName: string): PrimitiveName | undefined {
  if (!toolName.startsWith("rhizomatic_")) return undefined;
  const primitive = toolName.slice("rhizomatic_".length).replace(/_/g, "-");
  return PrimitiveNames.includes(primitive as PrimitiveName) ? (primitive as PrimitiveName) : undefined;
}

export function toolNameFromPrimitive(primitive: PrimitiveName) {
  return `rhizomatic_${primitive.replace(/-/g, "_")}`;
}

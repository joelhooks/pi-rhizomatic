import * as JSONSchema from "effect/JSONSchema";
import { Schema } from "effect";

export const ContractVersion = "0.1.0";

export const PrimitiveNames = [
  "begin-session",
  "whoami",
  "briefing",
  "remember",
  "recall",
  "topics",
  "search",
  "same",
  "retract",
  "revise",
  "recast",
  "end-session",
  "post",
  "inbox",
  "ack",
  "decide",
  "replay",
  "explain",
  "trust",
  "as-of",
] as const;

export type PrimitiveName = (typeof PrimitiveNames)[number];

export const PrimitiveNameSchema = Schema.Literal(...PrimitiveNames).annotations({
  identifier: "PrimitiveName",
  description: "Rhizomatic primitive exposed over the HTTP service contract.",
});

export const JsonPrimitive = Schema.Union(Schema.String, Schema.Number, Schema.Boolean, Schema.Null).annotations({
  identifier: "JsonPrimitive",
});

export const EntityRef = Schema.Struct({
  entity: Schema.String,
  context: Schema.optional(Schema.String),
}).annotations({
  identifier: "EntityRef",
  description: "Typed reference to an entity the store can hold beliefs about.",
});

export const BeliefValue = Schema.Union(JsonPrimitive, EntityRef).annotations({
  identifier: "BeliefValue",
  description: "Primitive terminal content or an entity reference.",
});

export const RuntimeName = Schema.Literal("pi", "claude", "codex", "other").annotations({
  identifier: "RuntimeName",
});

export const RuntimeContext = Schema.Struct({
  runtime: RuntimeName,
  runtimeSessionId: Schema.optional(Schema.String),
  cwd: Schema.optional(Schema.String),
  surface: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
}).annotations({ identifier: "RuntimeContext" });

export const BeginSessionInput = Schema.Struct({
  model: Schema.optional(Schema.String),
  purpose: Schema.optional(Schema.String),
  topics: Schema.optional(Schema.Array(Schema.String)),
  surface: Schema.optional(Schema.String),
  mode: Schema.optional(Schema.String),
  runtime: Schema.optional(RuntimeName),
  runtimeSessionId: Schema.optional(Schema.String),
  idempotencyKey: Schema.optional(Schema.String),
}).annotations({ identifier: "BeginSessionInput" });
export type BeginSessionInput = typeof BeginSessionInput.Type;

export const RememberInput = Schema.Struct({
  about: Schema.String,
  attribute: Schema.String,
  value: BeliefValue,
  kind: Schema.optional(Schema.Literal("observation", "fact", "preference", "task", "summary", "canary")),
  speaker: Schema.optional(Schema.Literal("model", "user")),
  reason: Schema.optional(Schema.String),
  idempotencyKey: Schema.optional(Schema.String),
}).annotations({ identifier: "RememberInput" });
export type RememberInput = typeof RememberInput.Type;

export const RecallInput = Schema.Struct({
  about: Schema.optional(Schema.String),
  attribute: Schema.optional(Schema.String),
  query: Schema.optional(Schema.String),
  all: Schema.optional(Schema.Boolean),
}).annotations({ identifier: "RecallInput" });
export type RecallInput = typeof RecallInput.Type;

export const EndSessionInput = Schema.Struct({
  summary: Schema.optional(Schema.String),
  idempotencyKey: Schema.optional(Schema.String),
}).annotations({ identifier: "EndSessionInput" });
export type EndSessionInput = typeof EndSessionInput.Type;

export const PostInput = Schema.Struct({
  body: Schema.String,
  to: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
  about: Schema.optional(Schema.String),
  re: Schema.optional(Schema.String),
  idempotencyKey: Schema.optional(Schema.String),
}).annotations({ identifier: "PostInput" });

export const AckInput = Schema.Struct({
  messageId: Schema.String,
  note: Schema.optional(Schema.String),
  idempotencyKey: Schema.optional(Schema.String),
}).annotations({ identifier: "AckInput" });

export const GenericPrimitiveInput = Schema.Record({ key: Schema.String, value: Schema.Unknown }).annotations({
  identifier: "GenericPrimitiveInput",
  description: "Generic object payload for experimental primitives not yet narrowed in the public contract.",
});

export const PrimitiveInputSchemas = {
  "begin-session": BeginSessionInput,
  whoami: GenericPrimitiveInput,
  briefing: GenericPrimitiveInput,
  remember: RememberInput,
  recall: RecallInput,
  topics: GenericPrimitiveInput,
  search: GenericPrimitiveInput,
  same: GenericPrimitiveInput,
  retract: GenericPrimitiveInput,
  revise: GenericPrimitiveInput,
  recast: GenericPrimitiveInput,
  "end-session": EndSessionInput,
  post: PostInput,
  inbox: GenericPrimitiveInput,
  ack: AckInput,
  decide: GenericPrimitiveInput,
  replay: GenericPrimitiveInput,
  explain: GenericPrimitiveInput,
  trust: GenericPrimitiveInput,
  "as-of": GenericPrimitiveInput,
} as const satisfies Record<PrimitiveName, Schema.Schema.Any>;

export const Receipt = Schema.Struct({
  service: Schema.String,
  contractVersion: Schema.String,
  primitive: PrimitiveNameSchema,
  eventId: Schema.optional(Schema.String),
  sessionId: Schema.optional(Schema.String),
  runtime: Schema.optional(RuntimeName),
  store: Schema.optional(Schema.String),
  timestamp: Schema.String,
}).annotations({ identifier: "Receipt" });
export type Receipt = typeof Receipt.Type;

export const ErrorBody = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
  details: Schema.optional(Schema.Unknown),
}).annotations({ identifier: "ErrorBody" });

export const ToolResponse = Schema.Struct({
  ok: Schema.Boolean,
  data: Schema.optional(Schema.Unknown),
  error: Schema.optional(ErrorBody),
  receipt: Schema.optional(Receipt),
  _links: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
}).annotations({ identifier: "ToolResponse" });
export type ToolResponse = typeof ToolResponse.Type;

export const ConfigFile = Schema.Struct({
  serviceUrl: Schema.optional(Schema.String),
  backend: Schema.optional(Schema.Literal("rhizomatic-http", "chorus-http")),
  tokenEnv: Schema.optional(Schema.String),
  tokenSecretName: Schema.optional(Schema.String),
  outboxDir: Schema.optional(Schema.String),
  sessionDir: Schema.optional(Schema.String),
}).annotations({ identifier: "ConfigFile" });
export type ConfigFile = typeof ConfigFile.Type;

export function validatePrimitiveInput(primitive: PrimitiveName, input: unknown): Record<string, unknown> {
  const schema = PrimitiveInputSchemas[primitive] as Schema.Schema<unknown, unknown, never>;
  return Schema.decodeUnknownSync(schema)(input ?? {}, {
    onExcessProperty: "preserve",
  }) as Record<string, unknown>;
}

export function validateToolResponse(input: unknown): ToolResponse {
  return Schema.decodeUnknownSync(ToolResponse)(input, { onExcessProperty: "preserve" });
}

export function jsonSchemaFor(schema: Schema.Schema.Any): unknown {
  const out = JSONSchema.make(schema, { target: "openApi3.1" }) as unknown as Record<string, unknown>;
  delete out["$schema"];
  return out;
}

import { ContractVersion, PrimitiveInputSchemas, PrimitiveNames, ToolResponse, jsonSchemaFor } from "./schema.js";

export function makeOpenApi() {
  const schemas: Record<string, unknown> = {
    ToolResponse: jsonSchemaFor(ToolResponse),
  };

  const paths: Record<string, unknown> = {
    "/health": {
      get: {
        operationId: "health",
        summary: "Check service health",
        responses: {
          200: {
            description: "Service health",
            content: { "application/json": { schema: { type: "object" } } },
          },
        },
      },
    },
    "/contract": {
      get: {
        operationId: "contract",
        summary: "Return contract metadata and capabilities",
        responses: {
          200: {
            description: "Contract metadata",
            content: { "application/json": { schema: { type: "object" } } },
          },
        },
      },
    },
    "/openapi.json": {
      get: {
        operationId: "openapi",
        summary: "Return generated OpenAPI schema",
        responses: {
          200: {
            description: "OpenAPI 3.1 schema",
            content: { "application/json": { schema: { type: "object" } } },
          },
        },
      },
    },
  };

  for (const primitive of PrimitiveNames) {
    const schemaName = `${primitive.replace(/(^|-)([a-z])/g, (_match, _sep, char: string) => char.toUpperCase())}Input`;
    schemas[schemaName] = jsonSchemaFor(PrimitiveInputSchemas[primitive]);
    paths[`/v0/tools/${primitive}`] = {
      post: {
        operationId: primitive.replace(/-/g, "_"),
        summary: `Execute Rhizomatic primitive ${primitive}`,
        tags: ["primitives"],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: `#/components/schemas/${schemaName}` },
            },
          },
        },
        responses: {
          200: {
            description: "Primitive result",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ToolResponse" },
              },
            },
          },
          400: { description: "Invalid request" },
          401: { description: "Unauthorized" },
          404: { description: "Unknown primitive" },
          500: { description: "Server error" },
        },
      },
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Rhizomatic Service Contract",
      version: ContractVersion,
      description: "Portable HTTP JSON contract for Rhizomatic agent memory primitives. Auth, hosting, and storage are deployment choices.",
      license: { name: "MIT" },
    },
    servers: [{ url: "http://127.0.0.1:7331", description: "Local reference service" }],
    tags: [{ name: "primitives", description: "Rhizomatic memory primitives" }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
      },
      schemas,
    },
  };
}

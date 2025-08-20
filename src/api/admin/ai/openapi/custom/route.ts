import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi"
import { buildRegistry } from "./registry"

export const GET = async (_req: MedusaRequest, res: MedusaResponse) => {
  const registry = buildRegistry()
  const generator = new OpenApiGeneratorV31(registry.definitions)

  const doc = generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "JYT Admin APIs (Custom)",
      version: "1.0.0",
      description: "OpenAPI specification for custom admin routes under src/api/admin.",
    },
    servers: [{ url: "/admin", description: "Admin API base" }],
    security: [{ bearerAuth: [] }],
  })

  return res.json(doc)
}
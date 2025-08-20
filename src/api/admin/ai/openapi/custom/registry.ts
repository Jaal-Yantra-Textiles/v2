import { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi"
import { z } from "zod"
import "./zod-openapi-extend"

export const buildRegistry = () => {
  // Diagnostics: verify Zod is extended
  const zodHasOpenApi = typeof (z as any)?.ZodType?.prototype?.openapi === "function"
  console.log("[openapi] Zod has openapi on prototype:", zodHasOpenApi)

  // -----------------------------
  // OpenAPI-safe schema variants
  // -----------------------------

  // Design (avoid transforms/default effects/refinements)
  const ColorPaletteItem = z.object({ name: z.string(), code: z.string() })
  const MediaFile = z.object({
    id: z.string().optional(),
    url: z.string().openapi({ format: "uri" }),
    isThumbnail: z.boolean().optional(),
  })

  const DesignOpenAPISchema = z.object({
    name: z.string(),
    description: z.string().optional(),
    inspiration_sources: z.array(z.string()).optional(),
    design_type: z.enum(["Original", "Derivative", "Custom", "Collaboration"]).optional(),
    status: z
      .enum([
        "Conceptual",
        "In_Development",
        "Technical_Review",
        "Sample_Production",
        "Revision",
        "Approved",
        "Rejected",
        "On_Hold",
        "Commerce_Ready",
      ])
      .optional(),
    priority: z.enum(["Low", "Medium", "High", "Urgent"]).optional(),
    // Represent as RFC 3339 string for docs without using .datetime()
    target_completion_date: z.string().openapi({ format: "date-time" }).optional(),
    design_files: z.array(z.string()).optional(),
    thumbnail_url: z.string().openapi({ format: "uri" }).optional(),
    custom_sizes: z.record(z.any()).optional(),
    color_palette: z.array(ColorPaletteItem).optional(),
    tags: z.array(z.string()).optional(),
    estimated_cost: z.number().optional(),
    designer_notes: z.string().optional(),
    feedback_history: z
      .array(
        z.object({
          // for docs: use string date-time metadata only
          date: z.string().openapi({ format: "date-time" }).or(z.string()).optional(),
          feedback: z.string(),
          author: z.string(),
        })
      )
      .optional(),
    metadata: z.record(z.any()).optional(),
    media_files: z.array(MediaFile).optional(),
    moodboard: z.record(z.any()).optional(),
  })

  const UpdateDesignOpenAPISchema = DesignOpenAPISchema.partial()

  // Person (avoid transforms/refines)
  const PersonOpenAPISchema = z.object({
    first_name: z.string(),
    last_name: z.string(),
    email: z.string().openapi({ format: "email" }),
    date_of_birth: z.string().openapi({ format: "date-time" }).nullable().optional(),
    metadata: z.record(z.any()).optional(),
    addresses: z.array(z.any()).optional(),
    state: z.enum(["Onboarding", "Onboarding Finished", "Stalled", "Conflicted"]).optional(),
    avatar: z.string().optional(),
    public_metadata: z.record(z.any()).optional(),
  })

  const UpdatePersonOpenAPISchema = PersonOpenAPISchema.partial()

  // Query schemas (avoid preprocess/effects/refinements)
  const ReadDesignsQueryOpenAPISchema = z.object({
    fields: z.string().optional(),
    filters: z.object({}).optional(),
    sort: z.array(z.string()).optional(),
    limit: z.number().openapi({ format: "int32" }).optional(),
    offset: z.number().openapi({ format: "int32" }).optional(),
  })

  const ListPersonsQueryOpenAPISchema = z.object({
    fields: z.string().optional(),
    q: z.string().optional(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    email: z.string().optional(),
    state: z.enum(["Onboarding", "Onboarding Finished", "Stalled", "Conflicted"]).optional(),
    withDeleted: z.boolean().optional(),
    offset: z.number().openapi({ format: "int32" }).optional(),
    limit: z.number().openapi({ format: "int32" }).optional(),
    order: z.string().optional(),
  })

  const registry = new OpenAPIRegistry()

  const tryRegister = (name: string, schema: any) => {
    try {
      registry.register(name, schema)
      console.log(`[openapi] registered schema: ${name}`)
    } catch (e) {
      console.error(`[openapi] failed to register schema: ${name}`, e)
      throw e
    }
  }

  const tryRegisterPath = (path: any) => {
    try {
      registry.registerPath(path)
      console.log(`[openapi] registered path: ${path.path}`)
    } catch (e) {
      console.error(`[openapi] failed to register path: ${path.path}`, e)
      throw e
    }
  }

  // --- Security ---
  registry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
  })

  // --- Schemas ---
  tryRegister("Design", DesignOpenAPISchema)
  tryRegister("ReadDesignsQuery", ReadDesignsQueryOpenAPISchema)
  tryRegister("UpdateDesign", UpdateDesignOpenAPISchema)

  tryRegister("Person", PersonOpenAPISchema)
  tryRegister("ListPersonsQuery", ListPersonsQueryOpenAPISchema)
  tryRegister("UpdatePerson", UpdatePersonOpenAPISchema)

  // --- Paths: Designs ---
  tryRegisterPath({
    method: "get",
    path: "/admin/designs",
    tags: ["Designs"],
    summary: "List designs",
    security: [{ bearerAuth: [] }],
    request: {
      query: ReadDesignsQueryOpenAPISchema,
    },
    responses: {
      200: {
        description: "List of designs",
        content: {
          "application/json": {
            schema: z.object({
              items: z.array(DesignOpenAPISchema),
              count: z.number(),
            }),
          },
        },
      },
    },
  })

  tryRegisterPath({
    method: "post",
    path: "/admin/designs",
    tags: ["Designs"],
    summary: "Create design",
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        content: {
          "application/json": {
            schema: DesignOpenAPISchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: "Created design",
        content: {
          "application/json": {
            schema: z.object({ design: DesignOpenAPISchema }),
          },
        },
      },
    },
  })

  tryRegisterPath({
    method: "patch",
    path: "/admin/designs/{id}",
    tags: ["Designs"],
    summary: "Update design",
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          "application/json": {
            schema: UpdateDesignOpenAPISchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: "Updated design",
        content: {
          "application/json": {
            schema: z.object({ design: DesignOpenAPISchema }),
          },
        },
      },
    },
  })

  // --- Paths: Persons ---
  tryRegisterPath({
    method: "get",
    path: "/admin/persons",
    tags: ["Persons"],
    summary: "List persons",
    security: [{ bearerAuth: [] }],
    request: {
      query: ListPersonsQueryOpenAPISchema,
    },
    responses: {
      200: {
        description: "List of persons",
        content: {
          "application/json": {
            schema: z.object({
              items: z.array(PersonOpenAPISchema),
              count: z.number(),
            }),
          },
        },
      },
    },
  })

  tryRegisterPath({
    method: "post",
    path: "/admin/persons",
    tags: ["Persons"],
    summary: "Create person",
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        content: {
          "application/json": {
            schema: PersonOpenAPISchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: "Created person",
        content: {
          "application/json": {
            schema: z.object({ person: PersonOpenAPISchema }),
          },
        },
      },
    },
  })

  return registry
}

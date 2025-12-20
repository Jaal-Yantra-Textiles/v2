import { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi"
import { z } from "zod"
import * as fs from "fs"
import * as path from "path"
import "./zod-openapi-extend"

let cachedRegistry: OpenAPIRegistry | null = null

export const buildRegistry = () => {
  if (cachedRegistry) {
    return cachedRegistry
  }

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
    offset: z.number().openapi({ format: "int32" }).optional(),
    limit: z.number().openapi({ format: "int32" }).optional(),
    name: z.string().optional(),
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
    tags: z.array(z.string()).optional(),
  })

  const GetDesignQueryOpenAPISchema = z.object({
    fields: z.string().optional(),
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

  const registeredPathKeys = new Set<string>()

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
      const key = `${String(path?.method || "").toLowerCase()} ${String(path?.path || "")}`
      if (registeredPathKeys.has(key)) {
        return
      }
      registeredPathKeys.add(key)
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
  tryRegister("GetDesignQuery", GetDesignQueryOpenAPISchema)

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
              designs: z.array(DesignOpenAPISchema),
              count: z.number().optional(),
              offset: z.number().optional(),
              limit: z.number().optional(),
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
      201: {
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
    method: "get",
    path: "/admin/designs/{id}",
    tags: ["Designs"],
    summary: "Get design",
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({
        id: z
          .string()
          .openapi({ param: { name: "id", in: "path", required: true } }),
      }),
      query: GetDesignQueryOpenAPISchema,
    },
    responses: {
      200: {
        description: "Design",
        content: {
          "application/json": {
            schema: z.object({ design: DesignOpenAPISchema }),
          },
        },
      },
    },
  })

  tryRegisterPath({
    method: "put",
    path: "/admin/designs/{id}",
    tags: ["Designs"],
    summary: "Update design",
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({
        id: z
          .string()
          .openapi({ param: { name: "id", in: "path", required: true } }),
      }),
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

  tryRegisterPath({
    method: "delete",
    path: "/admin/designs/{id}",
    tags: ["Designs"],
    summary: "Delete design",
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({
        id: z
          .string()
          .openapi({ param: { name: "id", in: "path", required: true } }),
      }),
    },
    responses: {
      200: {
        description: "Deleted design",
        content: {
          "application/json": {
            schema: z.any(),
          },
        },
      },
      201: {
        description: "Deleted design",
        content: {
          "application/json": {
            schema: z.any(),
          },
        },
      },
    },
  })

  const autoRegister = () => {
    const tryRoots = [
      path.join(process.cwd(), "src", "api", "admin"),
      path.join(process.cwd(), "dist", "api", "admin"),
    ]

    const root = tryRoots.find((p) => {
      try {
        return fs.existsSync(p) && fs.statSync(p).isDirectory()
      } catch {
        return false
      }
    })

    if (!root) return

    const routeFiles: string[] = []
    const walk = (dir: string) => {
      let entries: fs.Dirent[] = []
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const ent of entries) {
        const full = path.join(dir, ent.name)
        if (ent.isDirectory()) {
          walk(full)
          continue
        }
        if (ent.isFile() && ent.name === "route.ts") {
          routeFiles.push(full)
        }
      }
    }
    walk(root)

    const toOpenApiPath = (rel: string) => {
      const noFile = rel.replace(/\/route\.ts$/, "")
      const segs = noFile.split("/").filter(Boolean)
      const mapped = segs.map((s) => {
        const m = s.match(/^\[(.+)\]$/)
        if (!m) return s
        return `{${m[1]}}`
      })
      return `/admin/${mapped.join("/")}`
    }

    const extractParams = (p: string) => {
      const re = /\{([^}]+)\}/g
      const out: string[] = []
      let m: RegExpExecArray | null
      while ((m = re.exec(p))) {
        if (m[1]) out.push(m[1])
      }
      return out
    }

    const toPathParamsSchema = (paramsList: string[]) => {
      if (!paramsList.length) return undefined
      const shape = Object.fromEntries(
        paramsList.map((k) => [
          k,
          z.string().openapi({ param: { name: k, in: "path", required: true } }),
        ])
      )
      return z.object(shape)
    }

    for (const file of routeFiles) {
      // Avoid documenting AI/OpenAPI endpoints inside the custom API doc itself
      const rel = path.relative(root, file).replace(/\\/g, "/")
      if (rel.startsWith("ai/openapi/") || rel.startsWith("ai/chat/") || rel.startsWith("ai/image-extraction/")) {
        continue
      }

      let src = ""
      try {
        src = fs.readFileSync(file, "utf8")
      } catch {
        continue
      }

      const methods = new Set<string>()
      for (const m of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
        const re = new RegExp(`export\\s+const\\s+${m}\\b`)
        if (re.test(src)) methods.add(m)
      }
      if (!methods.size) continue

      const pth = toOpenApiPath(rel)
      const paramsList = extractParams(pth)
      const paramsSchema = toPathParamsSchema(paramsList)

      const tag = rel.split("/")[0] ? String(rel.split("/")[0]) : "Custom"
      const tags = [tag.charAt(0).toUpperCase() + tag.slice(1)]

      for (const m of methods) {
        const lower = m.toLowerCase()
        const def: any = {
          method: lower,
          path: pth,
          tags,
          summary: `Auto: ${m} ${pth}`,
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: z.any() } } },
          },
        }
        if (paramsSchema) {
          def.request = def.request || {}
          def.request.params = paramsSchema
        }
        if (m === "GET") {
          // def.request = def.request || {}
          // def.request.query = z.object({}).passthrough().optional()
        } else {
          def.request = def.request || {}
          def.request.body = {
            content: {
              "application/json": { schema: z.any() },
            },
          }
        }
        try {
          console.log(`[openapi][auto] registering ${m} ${pth} from ${rel}`)
          tryRegisterPath(def)
        } catch (e) {
          console.error(`[openapi][auto] failed to register ${m} ${pth} from ${rel}`, e)
        }
      }
    }
  }

  try {
    autoRegister()
  } catch (e) {
    console.warn("[openapi] autoRegister failed", (e as any)?.message || e)
  }

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
      201: {
        description: "Created person",
        content: {
          "application/json": {
            schema: z.object({ person: PersonOpenAPISchema }),
          },
        },
      },
    },
  })

  cachedRegistry = registry
  return registry
}

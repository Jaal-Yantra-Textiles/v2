/**
 * Design flow tools — the core of the shop's chat-based design editor.
 *
 * The designer-guide walks a maker through: brief → moodboard → fabrics →
 * partner → generation → iteration. These tools are the flow's write side:
 *
 *   - save_brief          — validate + normalise the brief (product_type is
 *                           load-bearing: estimate + production spec derive from it)
 *   - generate_design_image — THE heart: resolves or creates the design (first
 *                           generation creates it — guest customer by email +
 *                           product-design link + moodboard seed), generates TWO
 *                           candidate canvases (A/B) and appends them to the
 *                           Excalidraw scene on design.moodboard
 *   - set_active_canvas   — the pick: scene marker + design.thumbnail_url
 *   - get_design_state    — design + scene summary so the chat resumes with
 *                           full context (editing an existing design)
 *
 * 🔴 Model-first, NEVER design.metadata (the #1486 metadata-replace lesson):
 * canvases live as Excalidraw image elements on design.moodboard (see
 * canvas-scene.ts); the only load-bearing column the flow touches is
 * design.thumbnail_url (active pick).
 *
 * Generation runs generateDesignAiImageWorkflow twice (one run per candidate —
 * each run does mastra imagegen + commit-mode media upload + design update).
 * The active pick is what reaches production; the workflow's unconditional
 * thumbnail stamp is corrected by set_active_canvas immediately after the pick.
 */
import type { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { tool, jsonSchema } from "ai"
import { z } from "zod"
import { DESIGN_MODULE } from "../../../modules/designs"
import type DesignService from "../../../modules/designs/service"
import {
  normalizeCanvasScene,
  readActiveCanvas,
  readCanvasElements,
  readGenerationReference,
  appendCanvasElements,
  markActiveCanvas,
  type CanvasScene,
  type CanvasMarker,
} from "../../../modules/designs/lib/canvas-scene"
import { normalizeProductType } from "../../../modules/designs/lib/product-type"
import { createDesignWorkflow } from "../../../workflows/designs/create-design"
import { linkProductWithDesignWorkflow } from "../../../workflows/products/link-unlink-products-with-designs"
import { generateDesignAiImageWorkflow } from "../../../workflows/ai/generate-design-image"
import { analyzeReferenceImages } from "./storefront-design-analysis"

// ── Shared resolvers ───────────────────────────────────────────────────

const resolveDesignService = (container: MedusaContainer): DesignService =>
  container.resolve(DESIGN_MODULE) as unknown as DesignService

/**
 * Find-or-create the guest customer keyed on the maker's email.
 * Pattern mirrors partner-quote mint-quote (#1507): exact email lookup,
 * adopt-or-create, never overwrite an adopted profile.
 */
export const runEnsureGuestCustomer = async (
  container: MedusaContainer,
  email: string
): Promise<{ customer_id: string; created: boolean }> => {
  const normalized = email.trim().toLowerCase()
  const customerService: any = container.resolve(Modules.CUSTOMER)

  const existing: any[] = await customerService
    .listCustomers({ email: normalized }, { take: 10 })
    .catch(() => [])

  const match = existing.find((c) => c?.has_account) ?? existing[0]
  if (match) {
    return { customer_id: match.id, created: false }
  }

  const created = await customerService.createCustomers({ email: normalized })
  return { customer_id: created.id, created: true }
}

/** Resolve base product images for generation references (initial canvases). */
const resolveProductImages = async (
  container: MedusaContainer,
  productId?: string
): Promise<string[]> => {
  if (!productId) return []
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product",
    filters: { id: productId },
    fields: ["id", "images.url", "thumbnail"],
  } as any)
  const product: any = data?.[0]
  if (!product) return []
  const urls: string[] = (product.images || [])
    .map((i: any) => i?.url)
    .filter((u: any) => typeof u === "string" && u.startsWith("http"))
  if (product.thumbnail && product.thumbnail.startsWith("http")) {
    urls.unshift(product.thumbnail)
  }
  return [...new Set(urls)]
}

/** Design context the tools carry per-turn (from the chat request context). */
export type DesignContext = {
  product_id?: string
  design_id?: string
  email?: string
}

/** Load a design with its canvas scene (null when absent or not owned). */
const loadDesignScene = async (
  container: MedusaContainer,
  designId: string
): Promise<{ design: any; scene: CanvasScene } | null> => {
  const designService = resolveDesignService(container)
  const design = await designService
    .retrieveDesign(designId)
    .catch(() => null)
  if (!design) return null
  return { design, scene: normalizeCanvasScene(design.moodboard) }
}

/** Persist the scene back onto the design (moodboard typed column). */
const saveScene = async (
  container: MedusaContainer,
  designId: string,
  scene: CanvasScene
): Promise<void> => {
  const designService = resolveDesignService(container)
  await designService.updateDesigns({
    id: designId,
    moodboard: scene as unknown as Record<string, unknown>,
  })
}

// ── save_brief ─────────────────────────────────────────────────────────

// ── Forgiving list coercion ────────────────────────────────────────────
// The design models keep formatting aesthetic_keywords / color_palette as
// JSON strings ('["handwoven", …]') or plain comma text instead of arrays —
// a strict zod schema rejects those and the model fumbles (and leaks raw
// JSON into its visible reply). Coerce BEFORE validating.
const coerceKeywords = (v: unknown): string[] | undefined => {
  if (v == null) return undefined
  let arr: any = v
  if (typeof v === "string") {
    try {
      arr = JSON.parse(v)
    } catch {
      arr = v.split(",").map((part) => part.trim()).filter(Boolean)
    }
  }
  if (!Array.isArray(arr)) arr = [arr]
  return arr
    .map((k) => String(k).trim().replace(/^["'\[\]]+|["'\[\]]+$/g, ""))
    .filter(Boolean)
    .slice(0, 5)
}

const coercePalette = (
  v: unknown
): Array<{ name: string; code: string }> | undefined => {
  if (v == null) return undefined
  let arr: any = v
  if (typeof v === "string") {
    try {
      arr = JSON.parse(v)
    } catch {
      arr = v.split(",").map((part) => part.trim()).filter(Boolean)
    }
  }
  if (!Array.isArray(arr)) arr = [arr]
  const palette = arr
    .map((entry: any) => {
      if (typeof entry === "string") {
        // "blue:#1e3a5f" → name/code split; bare word → name only.
        const [name, code] = entry.split(":").map((s) => s.trim())
        return { name: name || "", code: code || "" }
      }
      if (entry && typeof entry === "object") {
        return {
          name: String(entry.name ?? "").trim(),
          code: String(entry.code ?? entry.hex ?? "").trim(),
        }
      }
      return null
    })
    .filter((e: any) => e && (e.name || e.code))
    .slice(0, 8) as Array<{ name: string; code: string }>
  return palette.length ? palette : undefined
}

export type DesignBrief = {
  product_type: string | null
  concept_theme: string | null
  aesthetic_keywords: string[]
  color_palette: Array<{ name: string; code: string }>
}

const BriefSchema = z.object({
  product_type: z
    .string()
    .max(60)
    .optional()
    .describe(
      "The garment category — 'trousers', 'saree', 'kurta'. REQUIRED before generation: estimates and production specs derive from it. Ask the maker if unknown — only call save_brief once they've told you."
    ),
  concept_theme: z
    .string()
    .max(300)
    .optional()
    .describe("Short story/title for the design ('90s Tokyo streetwear')."),
  // ANY-typed + in-execute coercion: the AI-SDK validates model tool args
  // PRE-EXECUTE against the generated JSON schema, and empirically (probed
  // live across preprocess AND union+transform shapes) a strict array shape
  // rejects the model's JSON-string payloads before the coercer runs. z.any()
  // emits `{}` — accepts every shape the model sends — and runSaveBrief
  // coerces to the strict shape inside execute (JSON strings, comma text,
  // "name:#hex" splitting — probed).
  aesthetic_keywords: z
    .any()
    .optional()
    .describe("3-5 look-and-feel keywords ('utilitarian', 'sleek', 'nostalgic'). Pass as a JSON array of strings."),
  color_palette: z
    .any()
    .optional()
    .describe("Palette the design uses. Pass as a JSON array of { name, code } objects (code hex like '#1e3a5f')."),
})

export const runSaveBrief = async (
  args: z.infer<typeof BriefSchema>
): Promise<
  | { ok: true; brief: DesignBrief }
  | { ok: false; needs: "product_type"; message: string }
> => {
  // Validate + normalise here so the generate step always receives a usable
  // type. The value is validated only — persistence happens at design
  // creation (first generation), per the flow: design is created upon the
  // first image generation.
  //
  // NON-throwing when the type is missing: a premature call returns structured
  // guidance ("ask the maker") instead of a hard tool error the model retries
  // blindly — the retry loop surfaced as "Brief needs a garment type" x N in
  // live testing.
  const productType = normalizeProductType(args.product_type)
  if (!productType) {
    return {
      ok: false,
      needs: "product_type",
      message:
        "STOP calling save_brief. You called it without a garment type. Write ONE short question to the maker asking what they are designing (a kurta, trousers, a saree…) and END YOUR TURN. Do not call save_brief again until they answer with a garment name.",
    }
  }
  return {
    ok: true,
    brief: {
      product_type: productType,
      concept_theme: args.concept_theme?.trim() || null,
      // Coerce defensively here TOO — the schema preprocess only ran on
      // validated tool paths; direct callers (tests, internal reuse) may
      // pass raw model shapes (JSON strings / comma text).
      aesthetic_keywords:
        coerceKeywords(args.aesthetic_keywords) ?? [],
      color_palette: coercePalette(args.color_palette) ?? [],
    },
  }
}

/**
 * Hand-authored input schema for save_brief — bound via jsonSchema() (the
 * admin/partner MCP chats' pattern). The AI-SDK validates model args
 * PRE-EXECUTE against THIS schema, so the list fields accept BOTH real
 * arrays AND the double-encoded JSON strings the models keep emitting.
 * runSaveBrief coerces to the strict shape inside execute.
 */
export const SAVE_BRIEF_INPUT_SCHEMA = {
  type: "object",
  properties: {
    product_type: {
      type: "string",
      description:
        "The garment category — 'trousers', 'saree', 'kurta'. REQUIRED before generation: estimates and production specs derive from it. Ask the maker if unknown — only call save_brief once they've told you.",
    },
    concept_theme: {
      type: "string",
      description: "Short story/title for the design ('90s Tokyo streetwear').",
    },
    aesthetic_keywords: {
      type: ["array", "string"],
      items: { type: "string" },
      description:
        "3-5 look-and-feel keywords. Pass as a real JSON array of strings (NOT a string-encoded array).",
    },
    color_palette: {
      type: ["array", "string"],
      description:
        "Palette the design uses. Pass as a real JSON array of { name, code } objects (code hex like '#1e3a5f') (NOT a string-encoded array).",
    },
  },
  required: [],
}

export const createSaveBriefTool = () =>
  tool({
    description:
      "Validate and lock in the design brief before any generation. ONLY call this once the maker has told you the garment type (product_type) — if they haven't, ASK first and never call save_brief with a missing type (it returns needs='product_type'). Returns the normalised brief to carry into generation.",
    inputSchema: jsonSchema(SAVE_BRIEF_INPUT_SCHEMA as any),
    execute: async (args) => runSaveBrief(args as any),
  })

// ── create_design ──────────────────────────────────────────────────────
//
// Creates the design record EARLY — the moment the maker has expressed their
// design (brief) and given an email — rather than lazily at first generation.
// The email find-or-creates a guest customer and the workflow links it, so the
// maker is "registered" + associated with the design before any expensive
// image generation runs. Idempotent: if a design_id is already in context it
// returns it without creating a duplicate.

const CreateDesignSchema = z.object({
  email: z
    .string()
    .max(200)
    .optional()
    .describe("The maker's email — REQUIRED to save + associate the design."),
  name: z
    .string()
    .min(1)
    .max(120)
    .optional()
    .describe("Design name ('Indigo Kurta')."),
  brief: BriefSchema.describe("The normalised brief from save_brief."),
})

export type CreateDesignResult = {
  design_id: string
  created: boolean
}

export const runCreateDesign = async (
  container: MedusaContainer,
  args: z.infer<typeof CreateDesignSchema>,
  context?: DesignContext
): Promise<CreateDesignResult> => {
  const existingId = context?.design_id
  if (existingId) {
    const designService = resolveDesignService(container)
    const existing = await designService
      .retrieveDesign(existingId)
      .catch(() => null)
    if (existing) return { design_id: existingId, created: false }
  }

  const email = (args.email ?? context?.email)?.trim().toLowerCase()
  if (!email) {
    throw new Error(
      "I need your email to save the design before we go further. What email should I use?"
    )
  }

  const briefResult = await runSaveBrief(args.brief)
  if (!briefResult.ok) {
    throw new Error(briefResult.message)
  }
  const brief = briefResult.brief

  const { customer_id } = await runEnsureGuestCustomer(container, email)

  const { result: designResult, errors: designErrors } = await createDesignWorkflow(
    container as any
  ).run({
    input: {
      name: args.name?.trim() || brief.concept_theme || `${brief.product_type} design`,
      description: brief.concept_theme || undefined,
      design_type: "Custom",
      status: "Conceptual",
      origin_source: "ai-other",
      concept_theme: brief.concept_theme || undefined,
      aesthetic_keywords: brief.aesthetic_keywords.length
        ? (brief.aesthetic_keywords as unknown as Record<string, any>)
        : undefined,
      color_palette: brief.color_palette.length
        ? (brief.color_palette as unknown as Record<string, any>)
        : undefined,
      customer_id_for_link: customer_id,
      tags: ["custom", "customer-design", "chat-editor"],
    },
  })

  if (designErrors?.length) {
    throw designErrors[0]
  }

  return { design_id: (designResult as any).id, created: true }
}

export const createCreateDesignTool = (
  container: MedusaContainer,
  context?: DesignContext
) =>
  tool({
    description:
      "Create the maker's design record NOW (before any image generation). Call once the maker has expressed their design (brief) and given an email — it registers a guest customer by email and links them to the design. Idempotent — returns the existing design_id if one is already in context. Do NOT call generate_design_image until the design exists and the maker has explicitly said to generate.",
    inputSchema: CreateDesignSchema,
    execute: async (args) => runCreateDesign(container, args, context),
  })

// ── generate_design_image ──────────────────────────────────────────────

const GenerateSchema = z.object({
  design_id: z
    .string()
    .optional()
    .describe("The design to generate canvases for. Omit to create the design now (first generation)."),
  product_id: z
    .string()
    .optional()
    .describe("Base product the design is a variant of (its image seeds initial generation)."),
  email: z
    .string()
    .max(200)
    .optional()
    .describe("The maker's email — REQUIRED when creating the design now."),
  name: z
    .string()
    .min(1)
    .max(120)
    .optional()
    .describe("Design name when creating now ('Indigo Kurta — Take on the classic')."),
  brief: BriefSchema.describe("The normalised brief from save_brief."),
  kind: z
    .enum(["initial", "revision", "layer"])
    .default("initial")
    .describe(
      "initial — first generation (brief + base product/moodboard references); revision — re-imagine from the active canvas; layer — composite an addition on the active canvas."
    ),
  change_request: z
    .string()
    .max(1000)
    .optional()
    .describe("What this generation should do — the maker's ask for revision/layer."),
  materials_prompt: z
    .string()
    .max(500)
    .optional()
    .describe("Selected fabric as a prompt fragment ('indigo handwoven cotton, natural slub')."),
  material_inventory_id: z
    .string()
    .optional()
    .describe("Selected fabric's inventory item id — linked to the design for production + estimate."),
  partner_id: z
    .string()
    .optional()
    .describe("Selected production partner — linked to the design for production."),
  inspiration_images: z
    .array(z.string().url().max(2000))
    .max(8)
    .optional()
    .describe("Uploaded moodboard reference URLs (new designs) — seeded into the scene and used as generation references."),
  badges: z
    .object({
      style: z.string().max(120).optional(),
      color_family: z.string().max(200).optional(),
      body_type: z.string().max(120).optional(),
      embellishment_level: z.string().max(120).optional(),
      occasion: z.string().max(200).optional(),
    })
    .optional()
    .describe("Style preferences shaping the generation."),
})

export type GenerateResult = {
  design_id: string
  created_design: boolean
  kind: string
  reference_used: string | null
  candidates: Array<{
    canvas_id: string
    letter: "A" | "B"
    image_url: string
    prompt_used: string
  }>
  quota_remaining: number | null
  missing_setup?: string[]
}

export const runGenerateDesignImage = async (
  container: MedusaContainer,
  args: z.infer<typeof GenerateSchema>,
  context?: DesignContext
): Promise<GenerateResult> => {
  const designService = resolveDesignService(container)
  const missingSetup: string[] = []

  const productId = args.product_id ?? context?.product_id
  const email = args.email ?? context?.email

  // ── Resolve or create the design ──
  let designId = args.design_id ?? context?.design_id
  let createdDesign = false
  let scene: CanvasScene
  let brief: DesignBrief

  const briefResult = await runSaveBrief(args.brief)
  if (!briefResult.ok) {
    throw new Error(briefResult.message)
  }
  brief = briefResult.brief

  if (designId) {
    const loaded = await loadDesignScene(container, designId)
    if (!loaded) {
      throw new Error(`Design ${designId} not found or not accessible.`)
    }
    scene = loaded.scene
  } else {
    // First generation creates the design — brief + email REQUIRED.
    if (!email) {
      throw new Error(
        "I need your email to save the design before I can generate. What email should I use?"
      )
    }
    missingSetup.push("design")
    if (!productId) {
      // Standalone design (no base product) still needs a name.
    }
    const { customer_id } = await runEnsureGuestCustomer(container, email)

    // Seed the moodboard scene with the maker's inspirations. Each reference is
    // analysed on the fly — the vision result is stamped onto the media's
    // metadata and onto the element so the generation (and later turns) can
    // ground on a pre-computed description.
    let seedScene = normalizeCanvasScene(null)
    if (args.inspiration_images?.length) {
      const analyses = await analyzeReferenceImages(container, args.inspiration_images)
      for (const url of args.inspiration_images) {
        const fileId = `insp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const analysis = analyses.get(url)
        seedScene.files[fileId] = {
          id: fileId,
          dataURL: url,
          mimeType: "image/png",
          created: Date.now(),
          lastRetrieved: Date.now(),
        }
        seedScene.elements.push({
          id: `el-${fileId}`,
          type: "image",
          x: 40 + (seedScene.elements.length % 2) * 300,
          y: 40 + Math.floor(seedScene.elements.length / 2) * 300,
          width: 260,
          height: 260,
          angle: 0,
          strokeColor: "transparent",
          backgroundColor: "transparent",
          fillStyle: "solid",
          strokeWidth: 1,
          strokeStyle: "solid",
          roughness: 1,
          opacity: 100,
          roundness: null,
          isDeleted: false,
          boundElements: null,
          updated: Date.now(),
          link: url,
          locked: true,
          fileId,
          mimeType: "image/png",
          customData: {
            source: "inspiration",
            ...(analysis
              ? {
                  media_id: analysis.media_id,
                  analysis: {
                    title: analysis.title,
                    description: analysis.description,
                    suggestions: analysis.suggestions,
                    analyzed_at: analysis.analyzed_at,
                  },
                }
              : {}),
          },
        })
      }
    }

    const { result: designResult, errors: designErrors } = await createDesignWorkflow(
      container as any
    ).run({
      input: {
        name: args.name?.trim() || brief.concept_theme || `${brief.product_type} design`,
        description: brief.concept_theme || undefined,
        design_type: "Custom",
        status: "Conceptual",
        origin_source: "ai-other",
        concept_theme: brief.concept_theme || undefined,
        aesthetic_keywords: brief.aesthetic_keywords.length
          ? (brief.aesthetic_keywords as unknown as Record<string, any>)
          : undefined,
        color_palette: brief.color_palette.length
          ? (brief.color_palette as unknown as Record<string, any>)
          : undefined,
        moodboard: seedScene as unknown as Record<string, any>,
        customer_id_for_link: customer_id,
        tags: ["custom", "customer-design", "chat-editor"],
      },
    })

    if (designErrors?.length) {
      throw designErrors[0]
    }
    designId = (designResult as any).id
    createdDesign = true
    scene = seedScene

    // Link the base product (variant designs) — first-class product-design
    // link, NOT metadata.
    if (productId) {
      await linkProductWithDesignWorkflow(container as any)
        .run({
          input: { productId, designId: designId as string },
        })
        .catch((e: any) => {
          // Link failure must not kill the generation — the design exists.
        })
    }
  }

  // ── Resolve generation references ──
  const activeRef = readGenerationReference(scene)
  let referenceUsed: string | null = null
  let referenceImages: Array<{ url: string; weight?: number; prompt?: string }> = []

  if (args.kind !== "initial") {
    // revision/layer build on the ACTIVE canvas — require one.
    if (!activeRef) {
      throw new Error(
        "Pick one of the takes first (set the active canvas) before I can iterate on it."
      )
    }
    referenceUsed = activeRef
    referenceImages = [
      {
        url: activeRef,
        weight: 1,
        prompt: args.change_request || "iterate on this garment",
      },
    ]
  } else {
    // initial: base product image seeds a variant of the real garment;
    // standalone designs generate from brief + moodboard inspirations.
    const productImages = createdDesign ? [] : await resolveProductImages(container, productId)
    const inspirations = args.inspiration_images?.length
      ? args.inspiration_images
      : scene.elements
          .filter((el) => el.customData?.source === "inspiration" && typeof el.link === "string")
          .map((el) => el.link as string)

    const refs = [...productImages, ...inspirations].filter((u) => u.startsWith("http"))
    referenceUsed = refs[0] ?? null
    referenceImages = refs.map((url, i) => ({
      url,
      weight: i === 0 ? 1 : 0.6,
      prompt: args.change_request || undefined,
    }))
  }

  // Link selected material + partner (design-inventory / design-partners links
  // flow through the store update route on later edits; the generation itself
  // only needs the prompt fragments).
  const materialsPrompt = args.materials_prompt

  // ── Generate TWO candidates (A/B) ──
  const generatedAt = new Date().toISOString()
  const runGeneration = async () =>
    generateDesignAiImageWorkflow(container as any).run({
      input: {
        customer_id: (await runEnsureGuestCustomer(container, email as string)).customer_id,
        design_id: designId as string,
        mode: "commit",
        badges: args.badges,
        materials_prompt: materialsPrompt,
        reference_images: referenceImages.length ? referenceImages : undefined,
      },
    })

  const [runA, runB] = await Promise.all([runGeneration(), runGeneration()])
  for (const e of [...(runA.errors ?? []), ...(runB.errors ?? [])]) {
    if (e) throw e
  }
  const outA: any = runA.result
  const outB: any = runB.result

  const buildCandidate = async (
    out: any,
    letter: "A" | "B"
  ): Promise<{ canvasId: string; imageUrl: string; promptUsed: string }> => {
    const imageUrl = out?.preview_url || out?.image_url
    if (!imageUrl) {
      throw new Error(`Generation ${letter} failed — no image returned.`)
    }
    return {
      canvasId: `cv-${Date.now()}-${letter}`,
      imageUrl,
      promptUsed: out?.prompt_used || "AI-generated design",
    }
  }

  const [candA, candB] = await Promise.all([
    buildCandidate(outA, "A"),
    buildCandidate(outB, "B"),
  ])

  // ── Append BOTH candidates to the Excalidraw scene ──
  const parentCanvasId =
    args.kind !== "initial" && readActiveCanvas(scene)
      ? (readActiveCanvas(scene) as any).customData.canvas.id
      : null

  scene = appendCanvasElements(
    scene,
    [
      {
        canvasId: candA.canvasId,
        letter: "A",
        kind: args.kind,
        parentCanvasId,
        mediaId: outA?.media_id ?? null,
        imageUrl: candA.imageUrl,
        promptUsed: candA.promptUsed,
        materialsPrompt: materialsPrompt ?? null,
        badges: args.badges ?? null,
      },
      {
        canvasId: candB.canvasId,
        letter: "B",
        kind: args.kind,
        parentCanvasId,
        mediaId: outB?.media_id ?? null,
        imageUrl: candB.imageUrl,
        promptUsed: candB.promptUsed,
        materialsPrompt: materialsPrompt ?? null,
        badges: args.badges ?? null,
      },
    ],
    generatedAt
  )
  await saveScene(container, designId as string, scene)

  return {
    design_id: designId as string,
    created_design: createdDesign,
    kind: args.kind,
    reference_used: referenceUsed,
    candidates: [
      {
        canvas_id: candA.canvasId,
        letter: "A" as const,
        image_url: candA.imageUrl,
        prompt_used: candA.promptUsed,
      },
      {
        canvas_id: candB.canvasId,
        letter: "B" as const,
        image_url: candB.imageUrl,
        prompt_used: candB.promptUsed,
      },
    ],
    quota_remaining: outB?.quota_remaining ?? outA?.quota_remaining ?? null,
    missing_setup: missingSetup.length ? missingSetup : undefined,
  }
}

export const createGenerateDesignImageTool = (container: MedusaContainer, context?: DesignContext) =>
  tool({
    description:
      "Generate TWO candidate design canvases (A/B takes) and add them to the design board. The design is created on first generation (requires the maker's email). For revision/layer, pick an active canvas first — iteration builds on the picked take. Long-running (~20s each): tell the maker what you're doing before calling.",
    inputSchema: GenerateSchema,
    execute: async (args) => runGenerateDesignImage(container, args, context),
  })

// ── set_active_canvas ──────────────────────────────────────────────────

const SetActiveSchema = z.object({
  design_id: z.string().describe("The design whose board the canvas is on."),
  canvas_id: z.string().describe("The canvas the maker picked (take A or B)."),
})

export const runSetActiveCanvas = async (
  container: MedusaContainer,
  args: z.infer<typeof SetActiveSchema>
): Promise<{ ok: boolean; thumbnail_url: string | null }> => {
  const loaded = await loadDesignScene(container, args.design_id)
  if (!loaded) {
    throw new Error(`Design ${args.design_id} not found or not accessible.`)
  }

  const target = readCanvasElements(loaded.scene).find(
    (el) => el.customData?.canvas?.id === args.canvas_id
  )
  if (!target) {
    throw new Error(`Canvas ${args.canvas_id} is not on this design's board.`)
  }
  const imageUrl =
    (target.customData?.canvas && typeof target.link === "string" ? target.link : null) ??
    target.link

  const scene = markActiveCanvas(loaded.scene, args.canvas_id)
  await saveScene(container, args.design_id, scene)

  // The pick is load-bearing: thumbnail drives the account grid and what the
  // partner sees.
  const designService = resolveDesignService(container)
  await designService.updateDesigns({
    id: args.design_id,
    thumbnail_url: typeof imageUrl === "string" ? imageUrl : null,
  })

  return { ok: true, thumbnail_url: typeof imageUrl === "string" ? imageUrl : null }
}

export const createSetActiveCanvasTool = (container: MedusaContainer) =>
  tool({
    description:
      "Record the maker's pick of one canvas take (A or B) as the active design. Call this when they choose a take — it stamps the picked image as the design's thumbnail and future iterations build on it.",
    inputSchema: SetActiveSchema,
    execute: async (args) => runSetActiveCanvas(container, args),
  })

// ── get_design_state ───────────────────────────────────────────────────

const GetStateSchema = z.object({
  design_id: z.string().describe("The design to load."),
})

export type DesignStateSummary = {
  design_id: string
  name: string | null
  status: string | null
  product_type: string | null
  concept_theme: string | null
  aesthetic_keywords: string[]
  color_palette: Array<{ name: string; code: string }>
  thumbnail_url: string | null
  active_canvas: { id: string; image_url: string } | null
  canvases: Array<{
    id: string
    letter: string | null
    kind: string
    image_url: string
    active: boolean
  }>
  inspirations: Array<{
    id: string
    image_url: string
    title: string | null
    description: string | null
    suggestions: string[]
  }>
}

export const runGetDesignState = async (
  container: MedusaContainer,
  designId: string
): Promise<DesignStateSummary> => {
  const loaded = await loadDesignScene(container, designId)
  if (!loaded) {
    throw new Error(`Design ${designId} not found or not accessible.`)
  }
  const { design, scene } = loaded
  const active = readActiveCanvas(scene)

  return {
    design_id: design.id,
    name: design.name ?? null,
    status: design.status ?? null,
    product_type: design.product_type ?? null,
    concept_theme: design.concept_theme ?? null,
    aesthetic_keywords: Array.isArray(design.aesthetic_keywords)
      ? (design.aesthetic_keywords as unknown as string[])
      : [],
    color_palette: Array.isArray(design.color_palette)
      ? (design.color_palette as unknown as Array<{ name: string; code: string }>)
      : [],
    thumbnail_url: design.thumbnail_url ?? null,
    active_canvas: active
      ? {
          id: active.customData!.canvas!.id,
          image_url:
            (scene.files[active.fileId as string]?.dataURL as string) ??
            (typeof active.link === "string" ? active.link : ""),
        }
      : null,
    canvases: readCanvasElements(scene).map((el) => ({
      id: el.customData!.canvas!.id,
      letter: el.customData!.canvas!.letter ?? null,
      kind: el.customData!.canvas!.kind,
      image_url:
        (scene.files[el.fileId as string]?.dataURL as string) ??
        (typeof el.link === "string" ? el.link : ""),
      active: Boolean(el.customData!.canvas!.active),
    })),
    inspirations: scene.elements
      .filter((el) => el.customData?.source === "inspiration")
      .map((el) => {
        const analysis = el.customData?.analysis as
          | { title?: string; description?: string; suggestions?: string[] }
          | undefined
        return {
          id: el.id,
          image_url:
            (scene.files[el.fileId as string]?.dataURL as string) ??
            (typeof el.link === "string" ? el.link : ""),
          title: analysis?.title ?? null,
          description: analysis?.description ?? null,
          suggestions: Array.isArray(analysis?.suggestions)
            ? analysis!.suggestions
            : [],
        }
      }),
  }
}

export const createGetDesignStateTool = (container: MedusaContainer) =>
  tool({
    description:
      "Load a design's current state — brief, active canvas and the full take history on its board. Call this when resuming or editing an existing design so your guidance is grounded in what's already there.",
    inputSchema: GetStateSchema,
    execute: async (args) => runGetDesignState(container, args.design_id),
  })

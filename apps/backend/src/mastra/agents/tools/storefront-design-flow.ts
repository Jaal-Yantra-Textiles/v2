/**
 * Design flow tools — the core of the shop's chat-based design editor.
 *
 * The designer-guide walks a maker through: brief → moodboard → fabrics →
 * partner → generation → iteration. These tools are the flow's write side:
 *
 *   - save_brief          — validate + normalise the brief (product_type is
 *                           load-bearing: estimate + production spec derive from it)
 *   - generate_design_image — THE heart: resolves or creates the design (first
 *                           generation creates it — for the SIGNED-IN customer
 *                           (#2543 phase 2) + product-design link + moodboard seed), generates TWO
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
  appendInspirationElements,
  type CanvasScene,
  type CanvasMarker,
} from "../../../modules/designs/lib/canvas-scene"
import { normalizeProductType } from "../../../modules/designs/lib/product-type"
import { createDesignWorkflow } from "../../../workflows/designs/create-design"
import { linkProductWithDesignWorkflow } from "../../../workflows/products/link-unlink-products-with-designs"
import { generateDesignAiImageWorkflow } from "../../../workflows/ai/generate-design-image"
import { analyzeReferenceImages } from "./storefront-design-analysis"
import designCustomerLink from "../../../links/design-customer-link"
import {
  DESIGN_ACCESS_DENIED_MESSAGE,
  resolveDesignAccess,
  type DesignAccessCredentials,
  type DesignAccessGrant,
} from "../../../lib/design-access/authorize"
import { mintDesignAccessToken } from "../../../lib/design-access/token"
import { consumeImageGeneration } from "../../../lib/design-access/rate-limits"

// ── Shared resolvers ───────────────────────────────────────────────────

const resolveDesignService = (container: MedusaContainer): DesignService =>
  container.resolve(DESIGN_MODULE) as unknown as DesignService

/**
 * ── The design a chat is already working on ─────────────────────────────
 *
 * 🔴 #1689: one ask produced TWO designs, 24 seconds apart. `create_design`
 * was described as idempotent, and it is — but only against
 * `context.design_id`, which is supplied by the CLIENT. The client learns the
 * id by scanning the finished turn's tool output, so:
 *
 *   - two `create_design` calls inside ONE turn both see an empty context, and
 *   - a turn whose tool parts the client failed to read leaves the next turn
 *     with an empty context too.
 *
 * Either way the "idempotent" tool mints a second design. An idempotency key
 * that only the client can supply is not an idempotency key.
 *
 * So the maker is asked instead of the client: does this maker already have a
 * chat design open? Bounded three ways, because "reuse the maker's design" is
 * a dangerous instruction without limits — it must never adopt a design from
 * last week that they have since sent to a partner.
 *
 *   1. it came from THIS flow (the `chat-editor` tag),
 *   2. it is still `Conceptual` — nothing downstream has happened to it,
 *   3. it was created inside the window below.
 *
 * A maker who wants a genuinely new design says "start a new design", which
 * the client handles as a domain keyword — and would otherwise land here. That
 * is what the window is for: a new session tomorrow is a new design; a second
 * tool call this minute is the same one.
 */
const OPEN_CHAT_DESIGN_WINDOW_MS = 2 * 60 * 60 * 1000

export const findOpenChatDesign = async (
  container: MedusaContainer,
  customerId: string
): Promise<string | null> => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
  const { data: links = [] } = await query
    .graph({
      entity: designCustomerLink.entryPoint,
      fields: ["design_id"],
      filters: { customer_id: customerId },
    })
    .catch(() => ({ data: [] }))

  // ⚠️ An empty relation comes back as a single all-null row, not an empty
  // array — filter on the value, not on `links.length`.
  const designIds = [
    ...new Set(
      (links as any[]).map((l) => l?.design_id).filter((id): id is string => !!id)
    ),
  ]
  if (!designIds.length) return null

  const designService = resolveDesignService(container)
  const designs: any[] = await (designService as any)
    .listDesigns(
      { id: designIds, status: "Conceptual" },
      { order: { created_at: "DESC" }, take: 50 }
    )
    .catch(() => [])

  const cutoff = Date.now() - OPEN_CHAT_DESIGN_WINDOW_MS
  const open = designs.find((d) => {
    const tags = Array.isArray(d?.tags) ? d.tags : []
    if (!tags.includes("chat-editor")) return false
    const createdAt = d?.created_at ? new Date(d.created_at).getTime() : NaN
    return Number.isFinite(createdAt) && createdAt >= cutoff
  })

  return open?.id ?? null
}

/**
 * The signed-in customer's open studio design, or a fresh empty one (#2543
 * phase 2). Used where photos arrive before the chat has made a design — the
 * reference upload route and `POST /store/custom/design-assistant/designs`.
 *
 * 🔑 Deliberately NOT inferring a `product_type`: that field is load-bearing
 * (production spec and estimate derive from it) and belongs to `save_brief`.
 */
export const resolveOrCreateStudioDesignForCustomer = async (
  container: MedusaContainer,
  customerId: string,
  name?: string
): Promise<{ design_id: string; design_token: string; created: boolean }> => {
  const open = await findOpenChatDesign(container, customerId)
  if (open) {
    return { design_id: open, design_token: mintDesignAccessToken(open, customerId), created: false }
  }
  const { result, errors } = await createDesignWorkflow(container as any).run({
    input: {
      name: name?.trim() || "New design from your photos",
      description: "",
      design_type: "Custom",
      status: "Conceptual",
      origin_source: "ai-other",
      customer_id_for_link: customerId,
      tags: ["custom", "customer-design", "chat-editor"],
    } as any,
  })
  if (errors?.length) throw errors[0]
  const designId = (result as any).id as string
  return { design_id: designId, design_token: mintDesignAccessToken(designId, customerId), created: true }
}

/**
 * Resolve the design this turn should write to, creating one only if the maker
 * genuinely has none open.
 *
 * 🔑 It MUTATES `context.design_id` on the way out. The context object is
 * built once per request and handed to every tool factory, so stamping it is
 * what makes a second `create_design` — or a `generate_design_image` that
 * follows in the same turn — resolve to the design that was just made rather
 * than mint another beside it.
 */
export const resolveOrCreateChatDesign = async (
  container: MedusaContainer,
  input: {
    customerId: string
    name?: string
    brief: DesignBrief
    context?: DesignContext
  }
): Promise<{ design_id: string; created: boolean; design_token: string }> => {
  const { context, customerId, brief } = input

  const contextId = context?.design_id
  if (contextId) {
    // 🔴 #2543: the context's design is only ours to reuse with a token for it
    // (or a session that owns it). A design id alone is a string anyone types.
    const grant = await assertToolDesignAccess(container, contextId, context)
    const designService = resolveDesignService(container)
    const existing = await designService
      .retrieveDesign(contextId)
      .catch(() => null)
    if (existing) {
      const token = tokenForGrant(contextId, grant, context)
      return { design_id: contextId, created: false, design_token: token }
    }
  }

  /**
   * 🔴 #2543: adopting "the maker's open chat design" is keyed on the
   * CUSTOMER — and for a guest the customer is whoever typed the email. Doing
   * this for an email alone handed any visitor the design (and a fresh token
   * for it) of whoever last chatted under that address. Only a signed-in
   * session that IS that customer may adopt; a guest without a token gets a
   * new design. (Same-turn duplicates (#1689) are still prevented by the
   * context stamp below.)
   */
  const open =
    context?.customer_id && context.customer_id === customerId
      ? await findOpenChatDesign(container, customerId)
      : null
  if (open) {
    const token = mintDesignAccessToken(open, customerId)
    if (context) {
      context.design_id = open
      context.design_token = token
    }
    return { design_id: open, created: false, design_token: token }
  }

  const { result, errors } = await createDesignWorkflow(container as any).run({
    input: {
      name:
        input.name?.trim() ||
        brief.concept_theme ||
        `${brief.product_type} design`,
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
      customer_id_for_link: customerId,
      tags: ["custom", "customer-design", "chat-editor"],
    } as any,
  })
  if (errors?.length) throw errors[0]

  const designId = (result as any).id
  const token = mintDesignAccessToken(designId, customerId)
  if (context) {
    context.design_id = designId
    context.design_token = token
  }
  return { design_id: designId, created: true, design_token: token }
}

/**
 * Find-or-create the guest customer keyed on the maker's email.
 *
 * ⚠️ #2543 phase 2: the chat tools and the reference-upload route no longer
 * call this — an email typed into a public chat proves nothing. Kept for
 * tests and for callers that already hold a verified address.
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

/**
 * Design context the tools carry per-turn (from the chat request context).
 *
 * 🔑 Built by the ROUTE, never by the model: `design_token` comes from the
 * storefront request (and is replaced when a tool mints a design), while
 * `customer_id` / `client_ip` are server-derived. Tools check every design id
 * — including one the model passes as an argument — against these.
 */
export type DesignContext = {
  product_id?: string
  design_id?: string
  email?: string
  /** Capability token for `design_id` (see lib/design-access/token.ts). */
  design_token?: string
  /** Authenticated customer actor id, when the shopper is signed in. */
  customer_id?: string
  /** Shopper IP, for the image-generation rate limit. */
  client_ip?: string
}

const credentialsOf = (
  context?: DesignContext | DesignAccessCredentials
): DesignAccessCredentials => {
  const c: any = context ?? {}
  return {
    token: c.design_token ?? c.token ?? null,
    customerId: c.customer_id ?? c.customerId ?? null,
  }
}

/** The token to hand back for a granted design: the presented one, or a fresh
 * one when access came through the signed-in customer instead. */
const tokenForGrant = (
  designId: string,
  grant: DesignAccessGrant,
  context?: DesignContext
): string =>
  grant.via === "token" && context?.design_token
    ? context.design_token
    : mintDesignAccessToken(designId, grant.customer_id)

/**
 * What the MODEL sees of a tool result that carries a design token (#2543).
 * The UI stream still gets the full output — that is how the storefront
 * receives the token — but the model has no use for it and every reason not
 * to repeat it into prose, logs or a later tool argument.
 */
const withoutDesignToken = (output: unknown) => {
  if (output && typeof output === "object" && "design_token" in output) {
    const { design_token: _omit, ...rest } = output as Record<string, unknown>
    return { type: "json" as const, value: rest as any }
  }
  return { type: "json" as const, value: (output ?? null) as any }
}

/**
 * Tool-side ownership gate. Throws a plain Error (the AI SDK hands its message
 * to the model, which relays it) rather than an HTTP error.
 */
const assertToolDesignAccess = async (
  container: MedusaContainer,
  designId: string,
  context?: DesignContext | DesignAccessCredentials
): Promise<DesignAccessGrant> => {
  const grant = await resolveDesignAccess(container, designId, credentialsOf(context))
  if (!grant) throw new Error(DESIGN_ACCESS_DENIED_MESSAGE)
  return grant
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

// ── Sign-in gate (#2543 phase 2) ───────────────────────────────────────
//
// Creating a design and generating images are tied to a VERIFIED buyer: the
// signed-in customer the chat route reads from the session
// (`context.customer_id`). They used to find-or-create a guest customer from
// whatever email the model passed — an address nobody had proven, which let
// any visitor file designs (and paid generations) under someone else's email.
// Without a session these tools now return this result instead of acting; the
// storefront shows its "Verify your email" panel when it sees it.

export const SIGN_IN_REQUIRED_MESSAGE =
  "The maker needs to verify their email before I can save or generate a design. Ask them to use the \"Verify your email\" panel (they'll get a 6-digit code), then continue. Do NOT ask them to type their email in the chat."

export type SignInRequiredResult = {
  sign_in_required: true
  action: "create_design" | "generate_design_image"
  message: string
}

const signInRequired = (
  action: SignInRequiredResult["action"]
): SignInRequiredResult => ({
  sign_in_required: true,
  action,
  message: SIGN_IN_REQUIRED_MESSAGE,
})

export const isSignInRequired = (value: unknown): value is SignInRequiredResult =>
  !!value && typeof value === "object" && (value as any).sign_in_required === true

// ── create_design ──────────────────────────────────────────────────────
//
// Creates the design record EARLY — the moment the maker has expressed their
// design (brief) — rather than lazily at first generation, linked to the
// signed-in customer. Idempotent: if a design_id is already in context it
// returns it without creating a duplicate.

const CreateDesignSchema = z.object({
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
  /** Capability token the storefront must keep and send back (#2543). */
  design_token: string
}

export const runCreateDesign = async (
  container: MedusaContainer,
  args: z.infer<typeof CreateDesignSchema>,
  context?: DesignContext
): Promise<CreateDesignResult | SignInRequiredResult> => {
  // 🔴 #2543 phase 2: the customer is the SESSION's, never an email argument.
  const customer_id = context?.customer_id
  if (!customer_id) return signInRequired("create_design")

  const briefResult = await runSaveBrief(args.brief)
  if (!briefResult.ok) {
    throw new Error(briefResult.message)
  }
  const brief = briefResult.brief

  /**
   * The resolver checks the context, then the maker's open chat design, then
   * creates — and stamps `context.design_id` either way, so a SECOND
   * `create_design` in this same turn lands on the design this one made.
   * See #1689: two designs, 24 seconds apart, from one ask.
   */
  return resolveOrCreateChatDesign(container, {
    customerId: customer_id,
    name: args.name,
    brief,
    context,
  })
}

export const createCreateDesignTool = (
  container: MedusaContainer,
  context?: DesignContext
) =>
  tool({
    description:
      "Create the maker's design record NOW (before any image generation), saved to the SIGNED-IN maker's account. Call once the maker has expressed their design (brief). If the maker has not verified their email yet it returns sign_in_required — then ask them to verify their email with the panel shown under the chat (never ask them to type an email in the chat) and stop. Idempotent — returns the existing design_id if one is already in context. Do NOT call generate_design_image until the design exists and the maker has explicitly said to generate.",
    inputSchema: CreateDesignSchema,
    execute: async (args) => runCreateDesign(container, args, context),
    toModelOutput: withoutDesignToken,
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
  /** Capability token for the design (#2543) — the storefront keeps it. */
  design_token: string
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
  /**
   * `z.input`, not `z.infer`. The output type marks `kind` as always present
   * because the schema defaults it — true of the TOOL path, where the model's
   * arguments are parsed, and false of every direct call, which is what this
   * export exists for. Typing the parsed shape here told callers a guarantee
   * the function does not actually receive.
   */
  args: z.input<typeof GenerateSchema>,
  context?: DesignContext
): Promise<GenerateResult | SignInRequiredResult> => {
  /**
   * 🔴 #2543 phase 2: every call is two PAID generations. Only a signed-in
   * customer generates — a design token alone (the guest capability) still
   * reads and picks, but no longer spends.
   */
  const sessionCustomerId = context?.customer_id
  if (!sessionCustomerId) return signInRequired("generate_design_image")

  const designService = resolveDesignService(container)
  const missingSetup: string[] = []

  /**
   * 🔴 Normalised, not read raw. `GenerateSchema` declares `.default("initial")`
   * so the TOOL path can never see `undefined` — but this function is exported
   * and callable directly, and there the default has not run. Every use below
   * was written as `args.kind !== "initial"`, which sends an ABSENT kind down
   * the iterate branch: the very first generation, before any canvas exists,
   * gets refused with "Pick one of the takes first".
   *
   * The first call is the one with nothing to compare against, and asking
   * "is it not initial?" answers yes for `undefined` — the same shape as a
   * first payment claim measured against a tally of prior claims (#1676).
   * Asking positively instead means an unknown value fails safe.
   */
  const kind = args.kind ?? "initial"

  const productId = args.product_id ?? context?.product_id

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

  let designToken: string | null = null
  let grantCustomerId: string | null = null

  if (designId) {
    // 🔴 #2543: a model-supplied (or client-supplied) design id is checked
    // against the SESSION before anything is read or spent — the signed-in
    // customer must be linked to the design. A token alone does not pay for
    // generations (phase 2).
    const grant = await assertToolDesignAccess(container, designId, {
      customer_id: sessionCustomerId,
    })
    grantCustomerId = grant.customer_id
    designToken = tokenForGrant(designId, grant, context)
    const loaded = await loadDesignScene(container, designId)
    if (!loaded) {
      throw new Error(`Design ${designId} not found or not accessible.`)
    }
    scene = loaded.scene
  } else {
    // No design yet. This is where the second design used to come from
    // (#1689): the branch minted unconditionally, so any turn that reached it
    // with an empty context made another one. It now resolves the maker's
    // open chat design first and only creates when there genuinely is none.
    const customer_id = sessionCustomerId

    const resolvedDesign = await resolveOrCreateChatDesign(container, {
      customerId: customer_id,
      name: args.name,
      brief,
      context,
    })
    designId = resolvedDesign.design_id
    designToken = resolvedDesign.design_token
    grantCustomerId = customer_id
    createdDesign = resolvedDesign.created
    if (createdDesign) missingSetup.push("design")

    /**
     * Start from what is already on the board. A resolved (rather than freshly
     * created) design may already carry the maker's photos — the reference
     * upload route puts them there before a single word is typed — and seeding
     * a blank scene over it would erase them.
     */
    const loaded = await loadDesignScene(container, designId as string)
    scene = loaded?.scene ?? normalizeCanvasScene(null)

    // Seed the maker's inspirations. Each is analysed on the fly so the
    // generation (and later turns) can ground on a pre-computed description.
    //
    // 🔑 `appendInspirationElements`, not an inline rebuild. This block WAS
    // the inline original; #1691 extracted it for the upload route and left
    // the twin behind here. Two homes for one shape is how the run-line
    // pricer drifted 22% apart.
    if (args.inspiration_images?.length) {
      const analyses = await analyzeReferenceImages(
        container,
        args.inspiration_images
      ).catch(() => new Map())
      scene = appendInspirationElements(
        scene,
        args.inspiration_images.map((url) => {
          const analysis: any = analyses.get(url)
          return {
            url,
            media_id: analysis?.media_id ?? null,
            analysis: analysis
              ? {
                  title: analysis.title ?? null,
                  description: analysis.description ?? null,
                  suggestions: analysis.suggestions ?? [],
                  analyzed_at: analysis.analyzed_at ?? null,
                }
              : null,
          }
        })
      )
      await saveScene(container, designId as string, scene)
    }

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

  if (kind === "revision" || kind === "layer") {
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

  // ── Rate limit (#2543) — each call is two paid generations ──
  consumeImageGeneration({ designId: designId as string, ip: context?.client_ip })

  // ── Generate TWO candidates (A/B) ──
  const generatedAt = new Date().toISOString()
  const generationCustomerId = grantCustomerId ?? sessionCustomerId
  const runGeneration = async () =>
    generateDesignAiImageWorkflow(container as any).run({
      input: {
        customer_id: generationCustomerId,
        design_id: designId as string,
        mode: "commit",
        badges: args.badges,
        /**
         * 🔴 The brief was in hand here the whole time and was never passed.
         * `save_brief` normalises it, `create_design` persists it, the system
         * prompt reasons about it — and the generator, the one consumer that
         * decides what the maker actually SEES, was handed only badges and a
         * materials fragment. With neither, its style context defaulted to
         * "casual fashion".
         */
        design_brief: {
          product_type: brief.product_type,
          concept_theme: brief.concept_theme,
          aesthetic_keywords: brief.aesthetic_keywords,
          color_palette: brief.color_palette,
        },
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
    kind !== "initial" && readActiveCanvas(scene)
      ? (readActiveCanvas(scene) as any).customData.canvas.id
      : null

  scene = appendCanvasElements(
    scene,
    [
      {
        canvasId: candA.canvasId,
        letter: "A",
        kind,
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
        kind,
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
    design_token: designToken as string,
    created_design: createdDesign,
    kind,
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
      "Generate TWO candidate design canvases (A/B takes) and add them to the design board. The design is created on first generation, saved to the SIGNED-IN maker (returns sign_in_required if they have not verified their email — then ask them to verify with the panel under the chat, and stop). For revision/layer, pick an active canvas first — iteration builds on the picked take. Long-running (~20s each): tell the maker what you're doing before calling.",
    inputSchema: GenerateSchema,
    execute: async (args) => runGenerateDesignImage(container, args, context),
    toModelOutput: withoutDesignToken,
  })

// ── set_active_canvas ──────────────────────────────────────────────────

const SetActiveSchema = z.object({
  design_id: z.string().describe("The design whose board the canvas is on."),
  canvas_id: z.string().describe("The canvas the maker picked (take A or B)."),
})

export const runSetActiveCanvas = async (
  container: MedusaContainer,
  args: z.infer<typeof SetActiveSchema>,
  /** Who is asking (#2543) — required; there is no unauthenticated pick. */
  credentials: DesignContext | DesignAccessCredentials | undefined
): Promise<{ ok: boolean; thumbnail_url: string | null }> => {
  await assertToolDesignAccess(container, args.design_id, credentials)
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

export const createSetActiveCanvasTool = (
  container: MedusaContainer,
  context?: DesignContext
) =>
  tool({
    description:
      "Record the maker's pick of one canvas take (A or B) as the active design. Call this when they choose a take — it stamps the picked image as the design's thumbnail and future iterations build on it.",
    inputSchema: SetActiveSchema,
    execute: async (args) => runSetActiveCanvas(container, args, context),
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
  designId: string,
  credentials: DesignContext | DesignAccessCredentials | undefined
): Promise<DesignStateSummary> => {
  await assertToolDesignAccess(container, designId, credentials)
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

export const createGetDesignStateTool = (
  container: MedusaContainer,
  context?: DesignContext
) =>
  tool({
    description:
      "Load a design's current state — brief, active canvas and the full take history on its board. Call this when resuming or editing an existing design so your guidance is grounded in what's already there.",
    inputSchema: GetStateSchema,
    execute: async (args) =>
      runGetDesignState(container, args.design_id, context),
  })

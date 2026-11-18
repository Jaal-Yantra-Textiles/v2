/**
 * Several designs in one design chat, and references from links.
 *
 * The chat used to hold exactly one design: the prompt forbade a second
 * create_design, the server folded any new design into the maker's open one
 * (#1689), and the storefront wiped the whole thread to start another. A maker
 * who wants a kurta AND its matching trousers, or three takes on a shawl
 * family, had to start over each time.
 *
 * Now the conversation carries a list. `context.design_id` is still the ACTIVE
 * design — every existing tool keeps writing to it — and `context.designs`
 * holds the others, each access-checked by the route.
 *
 *   - start_new_design   — mint ANOTHER design (explicit ask), make it active
 *   - switch_design      — make one of the maker's designs active
 *   - list_my_designs    — what the maker has, with board counts
 *   - add_reference_link — read a pasted link (pin / post / shop page / image),
 *                          copy its images into our storage, analyse, pin
 *
 * 🔑 Tools that change the active design mutate the shared `DesignContext`
 * (same contract as `resolveOrCreateChatDesign`), so a tool called later in
 * the same turn writes to the design the maker just switched to.
 *
 * 🔴 Tokens go to the storefront (UI stream) and never to the model — the
 * `toModelOutput` strips them, nested ones included.
 */
import type { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { tool } from "ai"
import { z } from "zod"
import { DESIGN_MODULE } from "../../../modules/designs"
import {
  normalizeCanvasScene,
  readActiveCanvas,
  readCanvasElements,
} from "../../../modules/designs/lib/canvas-scene"
import designCustomerLink from "../../../links/design-customer-link"
import { resolveDesignAccess } from "../../../lib/design-access/authorize"
import { mintDesignAccessToken } from "../../../lib/design-access/token"
import {
  createFixedWindowLimiter,
  retryAfterMinutes,
  type RateLimitConfig,
} from "../../../lib/design-access/rate-limits"
import { UnsafeUrlError } from "../../../lib/website-scan/safe-fetch"
import {
  downloadReferenceImage,
  readReferenceLink,
  type Fetcher,
} from "../../../lib/design-references/read-reference-link"
import {
  analyzeStoredReferences,
  pinReferencesToDesign,
  storeReferenceFiles,
} from "../../../lib/design-references/pin-references"
import {
  assertToolDesignAccess,
  createChatDesign,
  resolveOrCreateStudioDesignForCustomer,
  runSaveBrief,
  signInRequired,
  tokenForGrant,
  type DesignContext,
  type SignInRequiredResult,
} from "./storefront-design-flow"

/** A conversation is a working session, not an archive. */
export const MAX_DESIGNS_PER_CONVERSATION = 12

const HOUR = 60 * 60 * 1000
/** New designs a signed-in maker may start per hour from the chat. */
export const NEW_DESIGN_LIMIT_PER_CUSTOMER: RateLimitConfig = { windowMs: HOUR, max: 10 }
/** Links read per shopper IP — each one is a page fetch plus up to 4 vision calls. */
export const REFERENCE_LINK_LIMIT_PER_IP: RateLimitConfig = { windowMs: 10 * 60 * 1000, max: 15 }

export const newDesignLimiter = createFixedWindowLimiter(NEW_DESIGN_LIMIT_PER_CUSTOMER)
export const referenceLinkLimiter = createFixedWindowLimiter(REFERENCE_LINK_LIMIT_PER_IP)

// ── shared ──────────────────────────────────────────────────────────────

/** Drop every `design_token` key, however deep — the model never needs one. */
export const stripDesignTokens = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripDesignTokens)
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "design_token") continue
      out[k] = stripDesignTokens(v)
    }
    return out
  }
  return value
}

const modelOutput = (output: unknown) => ({
  type: "json" as const,
  value: (stripDesignTokens(output) ?? null) as any,
})

/**
 * Make `designId` the active design, keeping the previous active one in the
 * list. Pure on the context object.
 */
export const activateDesign = (
  context: DesignContext,
  designId: string,
  designToken: string
): void => {
  const others = (context.designs ?? []).filter(
    (d) => d.design_id !== designId && d.design_id !== context.design_id
  )
  if (context.design_id && context.design_id !== designId) {
    others.unshift({ design_id: context.design_id, design_token: context.design_token })
  }
  context.designs = others.slice(0, MAX_DESIGNS_PER_CONVERSATION - 1)
  context.design_id = designId
  context.design_token = designToken
}

export type DesignCard = {
  design_id: string
  design_token?: string
  name: string | null
  product_type: string | null
  status: string | null
  thumbnail_url: string | null
  takes: number
  references: number
  picked_take: string | null
  active: boolean
}

export const summarizeDesign = (design: any, active: boolean): Omit<DesignCard, "design_token"> => {
  const scene = normalizeCanvasScene(design?.moodboard)
  const picked = readActiveCanvas(scene)
  return {
    design_id: design.id,
    name: design.name ?? null,
    product_type: design.product_type ?? null,
    status: design.status ?? null,
    thumbnail_url: design.thumbnail_url ?? null,
    takes: readCanvasElements(scene).length,
    references: scene.elements.filter((el: any) => el.customData?.source === "inspiration").length,
    picked_take: picked?.customData?.canvas?.letter ?? null,
    active,
  }
}

// ── start_new_design ────────────────────────────────────────────────────

const StartNewDesignSchema = z.object({
  name: z.string().min(1).max(120).optional().describe("Name for the new piece ('Matching indigo trousers')."),
  product_type: z
    .string()
    .max(60)
    .optional()
    .describe("The garment of the NEW piece, if the maker said it ('trousers'). Leave out if not said yet."),
  concept_theme: z.string().max(300).optional(),
})

export type StartNewDesignResult = {
  design_id: string
  design_token: string
  name: string | null
  product_type: string | null
  previous_design_id: string | null
  open_designs: number
}

export const runStartNewDesign = async (
  container: MedusaContainer,
  args: z.infer<typeof StartNewDesignSchema>,
  context: DesignContext,
  limiter = newDesignLimiter
): Promise<StartNewDesignResult | SignInRequiredResult | { ok: false; message: string }> => {
  const customerId = context.customer_id
  if (!customerId) return signInRequired("start_new_design")

  const open = 1 + (context.designs?.length ?? 0)
  if (context.design_id && open >= MAX_DESIGNS_PER_CONVERSATION) {
    return {
      ok: false,
      message: `This conversation already holds ${open} designs. Ask the maker to finish or set one aside before starting another.`,
    }
  }
  const gate = limiter.check(`customer:${customerId}`)
  if (!gate.allowed) {
    return {
      ok: false,
      message: `Too many new designs in the last hour. Try again in ${retryAfterMinutes(gate.retryAfterMs)} min — meanwhile keep working on the ones already open.`,
    }
  }

  // The garment is optional here — a maker may say "another one" before they
  // say what it is. When given, it is validated exactly as save_brief does.
  const briefResult = args.product_type
    ? await runSaveBrief({ product_type: args.product_type, concept_theme: args.concept_theme })
    : null
  const brief = briefResult && briefResult.ok ? briefResult.brief : null

  const designId = await createChatDesign(container, {
    customerId,
    name: args.name,
    brief: brief ?? (args.concept_theme
      ? { product_type: null, concept_theme: args.concept_theme, aesthetic_keywords: [], color_palette: [] }
      : null),
  })
  limiter.hit(`customer:${customerId}`)

  const previous = context.design_id ?? null
  const token = mintDesignAccessToken(designId, customerId)
  activateDesign(context, designId, token)

  return {
    design_id: designId,
    design_token: token,
    name: args.name?.trim() || null,
    product_type: brief?.product_type ?? null,
    previous_design_id: previous,
    open_designs: 1 + (context.designs?.length ?? 0),
  }
}

export const createStartNewDesignTool = (container: MedusaContainer, context: DesignContext) =>
  tool({
    description:
      "Start ANOTHER design in this conversation — a second piece (matching trousers, a dupatta for the kurta) or a fresh idea — and make it the active one. Only when the maker asks for a new or additional piece; NEVER to redo the current design (use generate_design_image revision for that). The earlier designs stay saved and the maker can switch back. Returns sign_in_required if they have not verified their email.",
    inputSchema: StartNewDesignSchema,
    execute: async (args) => runStartNewDesign(container, args, context),
    toModelOutput: modelOutput,
  })

// ── switch_design ───────────────────────────────────────────────────────

const SwitchDesignSchema = z.object({
  design_id: z.string().min(1).max(60).describe("The design to work on now (from the designs list)."),
})

export const runSwitchDesign = async (
  container: MedusaContainer,
  designId: string,
  context: DesignContext
): Promise<DesignCard> => {
  const known = (context.designs ?? []).find((d) => d.design_id === designId)
  const credentials =
    designId === context.design_id
      ? context
      : { design_token: known?.design_token, customer_id: context.customer_id }
  const grant = await assertToolDesignAccess(container, designId, credentials)

  const designService: any = container.resolve(DESIGN_MODULE)
  const design = await designService.retrieveDesign(designId).catch(() => null)
  if (!design) throw new Error(`Design ${designId} not found.`)

  const token = tokenForGrant(designId, grant, credentials as DesignContext)
  activateDesign(context, designId, token)
  return { ...summarizeDesign(design, true), design_token: token }
}

export const createSwitchDesignTool = (container: MedusaContainer, context: DesignContext) =>
  tool({
    description:
      "Switch which design you are working on. Call when the maker refers to another of their designs ('back to the kurta', 'the second one'). Everything after this — brief, references, takes, picks — applies to the design switched to.",
    inputSchema: SwitchDesignSchema,
    execute: async (args) => runSwitchDesign(container, args.design_id, context),
    toModelOutput: modelOutput,
  })

// ── list_my_designs ─────────────────────────────────────────────────────

export const runListMyDesigns = async (
  container: MedusaContainer,
  context: DesignContext
): Promise<{ designs: DesignCard[] }> => {
  const tokens = new Map<string, string | undefined>()
  if (context.design_id) tokens.set(context.design_id, context.design_token)
  for (const d of context.designs ?? []) tokens.set(d.design_id, d.design_token)

  // A signed-in maker also sees their other open chat designs — the ones from
  // an earlier visit that this thread does not know about.
  if (context.customer_id) {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
    const { data: links = [] } = await query
      .graph({
        entity: designCustomerLink.entryPoint,
        fields: ["design_id"],
        filters: { customer_id: context.customer_id },
      })
      .catch(() => ({ data: [] }))
    for (const l of links as any[]) {
      if (l?.design_id && !tokens.has(l.design_id)) tokens.set(l.design_id, undefined)
    }
  }
  if (!tokens.size) return { designs: [] }

  const designService: any = container.resolve(DESIGN_MODULE)
  const rows: any[] = await designService
    .listDesigns(
      { id: [...tokens.keys()] },
      { order: { updated_at: "DESC" }, take: MAX_DESIGNS_PER_CONVERSATION * 2 }
    )
    .catch(() => [])

  const designs: DesignCard[] = []
  for (const row of rows) {
    const known = row.id === context.design_id || (context.designs ?? []).some((d) => d.design_id === row.id)
    // Older designs from the account: only chat designs still in concept —
    // never one already sent to a partner.
    if (!known) {
      const tags = Array.isArray(row.tags) ? row.tags : []
      if (row.status !== "Conceptual" || !tags.includes("chat-editor")) continue
    }
    const grant = await resolveDesignAccess(container, row.id, {
      token: tokens.get(row.id) ?? null,
      customerId: context.customer_id ?? null,
    })
    if (!grant) continue
    designs.push({
      ...summarizeDesign(row, row.id === context.design_id),
      design_token:
        grant.via === "token" && tokens.get(row.id)
          ? tokens.get(row.id)
          : mintDesignAccessToken(row.id, grant.customer_id),
    })
    if (designs.length >= MAX_DESIGNS_PER_CONVERSATION) break
  }
  return { designs }
}

export const createListMyDesignsTool = (container: MedusaContainer, context: DesignContext) =>
  tool({
    description:
      "List the maker's designs — the ones in this conversation plus their other open chat designs — with garment, number of takes and references, and which is active. Call when they ask what they have, or before switch_design when it is unclear which design they mean.",
    inputSchema: z.object({}),
    execute: async () => runListMyDesigns(container, context),
    toModelOutput: modelOutput,
  })

// ── add_reference_link ──────────────────────────────────────────────────

const AddReferenceLinkSchema = z.object({
  url: z
    .string()
    .min(4)
    .max(2000)
    .describe("The link exactly as the maker pasted it — a Pinterest pin, Instagram post, shop product page, or an image URL."),
  design_id: z
    .string()
    .max(60)
    .optional()
    .describe("Which design it is for. Omit for the active design."),
})

export type AddReferenceLinkResult =
  | {
      ok: true
      design_id: string
      design_token: string
      created_design: boolean
      source_url: string
      page_title: string | null
      added: number
      references: Array<{
        image_url: string
        title: string | null
        description: string | null
        suggestions: string[]
      }>
    }
  | { ok: false; message: string }

export const runAddReferenceLink = async (
  container: MedusaContainer,
  args: z.infer<typeof AddReferenceLinkSchema>,
  context: DesignContext,
  deps: { fetcher?: Fetcher; limiter?: typeof referenceLinkLimiter } = {}
): Promise<AddReferenceLinkResult | SignInRequiredResult> => {
  const limiter = deps.limiter ?? referenceLinkLimiter

  // ── which design ──
  let designId = args.design_id ?? context.design_id ?? null
  let designToken: string
  let createdDesign = false
  if (designId) {
    const known = (context.designs ?? []).find((d) => d.design_id === designId)
    const credentials =
      designId === context.design_id
        ? context
        : { design_token: known?.design_token, customer_id: context.customer_id }
    const grant = await assertToolDesignAccess(container, designId, credentials)
    designToken = tokenForGrant(designId, grant, credentials as DesignContext)
  } else {
    // No design yet — same rule as photo uploads: only a signed-in maker gets
    // a design made for their references.
    if (!context.customer_id) return signInRequired("add_reference_link")
    const resolved = await resolveOrCreateStudioDesignForCustomer(
      container,
      context.customer_id,
      "New design from your references"
    )
    designId = resolved.design_id
    designToken = resolved.design_token
    createdDesign = resolved.created
    activateDesign(context, designId, designToken)
  }

  // ── rate limit, keyed on the shopper ──
  const ip = context.client_ip && context.client_ip !== "unknown" ? context.client_ip : null
  const key = ip ? `ip:${ip}` : `design:${designId}`
  const gate = limiter.check(key)
  if (!gate.allowed) {
    return {
      ok: false,
      message: `Too many links read just now. Try again in ${retryAfterMinutes(gate.retryAfterMs)} min, or upload the pictures instead.`,
    }
  }
  limiter.hit(key)

  // ── read the link, copy its images ──
  let read
  try {
    read = await readReferenceLink(args.url, deps.fetcher)
  } catch (err: any) {
    return {
      ok: false,
      message:
        err instanceof UnsafeUrlError
          ? "That link can't be opened from here. Ask the maker for a public link, or to upload the picture."
          : `Couldn't read that link: ${err?.message ?? "unknown error"}`,
    }
  }

  const downloads = await Promise.all(
    read.image_urls.map((u) => downloadReferenceImage(u, deps.fetcher).catch(() => null))
  )
  const files = downloads.filter((d): d is NonNullable<typeof d> => !!d)
  if (!files.length) {
    return {
      ok: false,
      message:
        "The pictures on that link couldn't be downloaded (often a login wall). Ask the maker to upload a screenshot instead.",
    }
  }

  const stored = await storeReferenceFiles(container, files)
  if (!stored.length) return { ok: false, message: "The pictures could not be stored. Try again." }

  const references = await analyzeStoredReferences(container, stored)
  await pinReferencesToDesign(
    container,
    designId,
    references,
    read.kind === "page" ? read.page_url : args.url
  )

  return {
    ok: true,
    design_id: designId,
    design_token: designToken,
    created_design: createdDesign,
    source_url: read.page_url,
    page_title: read.title,
    added: references.length,
    references: references.map((r) => ({
      image_url: r.url,
      title: r.analysis?.title || null,
      description: r.analysis?.description || null,
      suggestions: r.analysis?.suggestions ?? [],
    })),
  }
}

export const createAddReferenceLinkTool = (container: MedusaContainer, context: DesignContext) =>
  tool({
    description:
      "Read a link the maker pasted (Pinterest, Instagram, a shop's product page, or a direct image) and pin its pictures to a design's board as references, each analysed. Call it as soon as a link appears in their message — do not ask first. Uses the active design unless design_id says otherwise. Ground your next suggestion in the returned descriptions.",
    inputSchema: AddReferenceLinkSchema,
    execute: async (args) => runAddReferenceLink(container, args, context),
    toModelOutput: modelOutput,
  })

/**
 * Designer-guide system prompt for the shop's chat-based design editor.
 *
 * A sibling of `buildStorefrontChatSystem` (same model resolution, same
 * ai_search_chat role) with a different contract: the agent walks a maker
 * through designing a real product — brief → moodboard → fabrics → partner →
 * generation → iteration — grounded in server-resolved product + design state.
 *
 * Analysis-first flow: when the design starts from an existing product's
 * image, the agent analyses it FIRST (vision) and suggests design directions,
 * then suggests what is possible with our existing fabrics, then guides to a
 * production partner, then keeps the iteration loop going (revisions/layers).
 *
 * The route binds the design tools (see storefront-design-*.ts) when
 * `context` is present — the prompt here describes the flow those tools
 * implement. Tools write model-first data (Excalidraw scene on
 * design.moodboard, brief on typed columns); NEVER design.metadata.
 */
import type { UserPrefs } from "./storefront-chat"
import { formatPrefs } from "./storefront-chat"

export type DesignChatContext = {
  product_id?: string
  design_id?: string
  email?: string
  // Server-resolved product summary (route injects — never client prose).
  product?: {
    title?: string
    description?: string
    thumbnail?: string
    images?: string[]
  } | null
  // Server-resolved design state (route injects for existing designs).
  design?: {
    name?: string
    status?: string
    product_type?: string | null
    concept_theme?: string | null
    aesthetic_keywords?: string[]
    thumbnail_url?: string
    // Moodboard summary — so the agent is grounded on the board without an
    // extra get_design_state round-trip.
    board?: {
      active_canvas?: {
        letter?: string | null
        kind?: string
        prompt_used?: string
      } | null
      canvas_count?: number
      inspirations?: Array<{
        title?: string | null
        description?: string | null
      }>
    }
  } | null
}

const PRODUCT_CONTEXT = (ctx: DesignChatContext): string => {
  const p = ctx.product
  if (!p) return ""
  const lines = ["", "# The product being designed (server-resolved, real catalogue data)"]
  if (p.title) lines.push(`- Title: ${p.title}`)
  if (p.description) lines.push(`- Description: ${p.description.slice(0, 600)}`)
  if (p.thumbnail) lines.push(`- Image: ${p.thumbnail}`)
  if (p.images?.length) lines.push(`- All images: ${p.images.join(", ")}`)
  lines.push(
    "",
    "When designing from this product: it is a VARIANT of the real garment above. Generation seeds its image as the reference automatically — say so once so the maker knows the design builds on the real product. Use analyze_product_image FIRST for an image-grounded read (construction, palette, mood), then suggest concrete directions."
  )
  return lines.join("\n")
}

const DESIGN_CONTEXT = (ctx: DesignChatContext): string => {
  const d = ctx.design
  if (!d) return ""
  const lines = ["", "# The design being edited (server-resolved)"]
  if (d.name) lines.push(`- Name: ${d.name}`)
  if (d.status) lines.push(`- Status: ${d.status}`)
  if (d.product_type) lines.push(`- Garment type: ${d.product_type}`)
  if (d.concept_theme) lines.push(`- Concept: ${d.concept_theme}`)
  if (d.aesthetic_keywords?.length)
    lines.push(`- Aesthetic keywords: ${d.aesthetic_keywords.join(", ")}`)
  if (d.thumbnail_url) lines.push(`- Current design image: ${d.thumbnail_url}`)

  // Moodboard summary — canvas takes + reference analyses, so the agent is
  // grounded on the board without an extra get_design_state call.
  const board = d.board
  if (board) {
    const boardLines: string[] = []
    if (board.canvas_count != null) {
      boardLines.push(`- Takes on the board: ${board.canvas_count}`)
    }
    if (board.active_canvas) {
      const ac = board.active_canvas
      const bits = [ac.letter ? `take ${ac.letter}` : "a take", ac.kind]
        .filter(Boolean)
        .join(", ")
      boardLines.push(`- Active canvas: ${bits}`)
      if (ac.prompt_used) boardLines.push(`  prompt: ${ac.prompt_used}`)
    }
    if (board.inspirations?.length) {
      boardLines.push(
        `- Uploaded references (already analysed — use these descriptions, don't re-analyse):`
      )
      for (const insp of board.inspirations) {
        const desc = [insp.title, insp.description]
          .filter(Boolean)
          .join(" — ")
        boardLines.push(`  - ${desc || "(unreadable reference)"}`)
      }
    }
    if (boardLines.length) {
      lines.push("")
      lines.push("# Board state")
      lines.push(...boardLines)
    }
  }

  lines.push(
    "",
    "This design already exists — the board above is current. Iterations build on the ACTIVE canvas: pick before revising. You don't need to call get_design_state unless the maker asks for the full take history."
  )
  return lines.join("\n")
}

// ── Turn planner (query planner) ───────────────────────────────────────
// Heuristic, route-computed from the conversation — no extra LLM turn. The
// models kept firing save_brief without the two onboarding keys (garment
// type + email), looping on the structured guidance instead of asking. The
// planner emits a HARD directive block gating tool usage per turn.
const GARMENT_KEYWORDS = [
  "kurta", "kurta set", "shirt", "t-shirt", "tshirt", "trousers", "pants",
  "saree", "sari", "dress", "gown", "jacket", "coat", "blazer", "stole",
  "scarf", "dupatta", "shawl", "lehenga", "palazzo", "salwar", "kameez",
  "top", "blouse", "kaftan", "caftan", "skirt", "skirt-set", "coordinates", "set", "hoodie", "sweater", "cardigan",
  "tunic", "kimono", "robe", "vest", "shorts", "jumpsuit", "playsuit",
]
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]{2,}/

export type PlannedTurn = {
  garment_type: string | null
  has_email: boolean
  directive: string
}

export const planDesignTurn = (
  messages?: Array<{ role?: string; parts?: Array<any>; content?: string }>,
  context?: DesignChatContext
): PlannedTurn => {
  const userText = (messages || [])
    .filter((m) => m?.role === "user")
    .map((m) =>
      Array.isArray(m.parts)
        ? m.parts.filter((p) => p?.type === "text").map((p) => p?.text ?? "").join(" ")
        : String(m.content ?? "")
    )
    .join(" \n ")
    .toLowerCase()

  const garment = GARMENT_KEYWORDS.find((k) =>
    new RegExp(`\\b${k.replace(/[-]/g, "\\-")}\\b`).test(userText)
  )
  const hasEmail = Boolean(context?.email) || EMAIL_RE.test(userText)

  const lines: string[] = ["", "# TURN PLAN (route-computed — follow EXACTLY)"]
  if (!garment) {
    lines.push(
      "- 🔴 ONBOARDING REQUIRED: no garment named anywhere in this conversation. Your ONLY move this turn is ONE short question asking what they are designing. Do NOT call save_brief, create_design, list_raw_materials, list_partners, analyze_product_image or generate_design_image until a garment is named."
    )
  } else {
    lines.push(
      `- Garment on the board: ${garment}. You may lock the brief with product_type='${garment}'. Still confirm style/keywords conversationally — but never re-ask the garment.`
    )
  }
  if (!hasEmail) {
    lines.push(
      "- Email not shared yet: do NOT call create_design, capture_contact or generate_design_image (the design can't save). You may brief, browse fabrics and partners. Ask for the email once, naturally, right after the brief."
    )
  } else {
    lines.push(
      "- Email captured: once the brief is locked, call create_design (once) to save + associate the design, and capture_contact may run (once)."
    )
  }
  lines.push(
    "- 🔴 GENERATION GATE: NEVER call generate_design_image unless the maker has explicitly agreed THIS turn ('yes', 'go ahead', 'generate', 'do it'). Ask clearly first ('ready for me to generate two takes?') and wait for their yes."
  )

  return {
    garment_type: garment ?? null,
    has_email: has_email_safe(context?.email, userText),
    directive: lines.join("\n"),
  }
}

const has_email_safe = (contextEmail?: string, userText?: string): boolean =>
  Boolean(contextEmail) || EMAIL_RE.test(userText ?? "")

export const buildDesignChatSystem = (
  prefs?: UserPrefs,
  context?: DesignChatContext,
  messages?: Array<{ role?: string; parts?: Array<any>; content?: string }>
): string => {
  const hasProduct = Boolean(context?.product)
  const hasDesign = Boolean(context?.design)

  return `You are Cici's designer — a warm, hands-on design guide for Cici Label, a slow-fashion brand under Jaal Yantra Textiles (JYT). You help a maker design a real garment: you ground everything in their product or brief, our fabrics, and our production partners, and you keep the iteration loop going until they love a take.

# The flow (walk it in their order, never interrogate)
0. Intro — on first touch, greet them and, in one breath, show how it works: brief → fabrics → partner → a couple of generated takes they pick from. Then ask what garment they're designing.
1. Brief — what do they want? Lock the garment category (product_type — REQUIRED, estimates and production derive from it: ask once if unknown, never leave blank), concept theme, 3-5 aesthetic keywords, palette. 🔴 NEVER call save_brief until the maker has told you the garment type — a premature call returns needs='product_type' and wastes a turn. ASK, then call.
2. Save it — once the brief is locked AND you have their email, call create_design. This registers the maker (a guest customer by email) and links them to the design BEFORE any generation. From here the design exists and everything else attaches to it.
3. Moodboard — invite uploaded references ("upload a few inspirations and I'll pin them to your board"). Each uploaded reference is analysed on the fly and pinned with its description — board references shape generation.
4. Fabrics — call list_raw_materials and suggest a SHORT list of what we can make it from (composition, color, swatch). Render fabric chips. Keep it to a handful (default 6) — only list more when the maker asks to see all fabrics.
5. Partner — call list_partners to walk the production path: a Fabric Seller SOURCES the material, a Manufacturer CUTS & SEWS it. Each result carries its path role. Guide them source → make. Keep the list SHORT (default 6) — only list more when the maker asks to see all partners.
6. Generate — 🔴 ONLY after the maker explicitly says to generate. Ask clearly ("Ready for me to generate two takes?") and wait for a YES before calling generate_design_image. Each call is long (~20s per image — say "Generating two takes…" first). Both takes land on their board; the maker picks one.
7. Iterate — after the pick (set_active_canvas), keep the loop going: revision (re-imagine the active take) or layer (add a motif, change a detail). Ask before each generation, same as step 6.

# How to behave
- Analysis first: ${hasProduct ? "analyse the product image with analyze_product_image before suggesting anything — ground every direction in what you see (construction, palette, mood)." : "this flow has no base product — ground directions in the brief and any uploaded inspirations; generation creates the design from the brief."}
- One suggestion at a time after the take lands ("the indigo take reads more utilitarian — want me to push the palette warmer, or layer a border motif?").
- Render tool results as the UI cards (fabric chips, partner cards, canvas A/B) — never list them in prose by hand.
- The board is the maker's: canvas takes, inspirations and the active pick all live on one Excalidraw board they can see. Describe state in board terms ("your board now has two takes — A indigo, B natural").
- Uploaded references are pre-analysed (vision) and carry their description on the board — call get_design_state and read the inspirations' descriptions/suggestions instead of re-analysing the same image.
- Email: ask for it EARLY — right after the brief, because the design saves under it. Ask once, naturally ("what email should I save this design under?"). Call create_design after they give it; call capture_contact once.
- 🔴 NEVER auto-generate: image generation costs real quota and ~20s. Always ask for an explicit yes first ("ready for me to generate two takes on this?") and only call generate_design_image after they confirm. If they describe changes instead of confirming, treat it as a revision request and confirm again.
- Estimates/checkout come later: once a take is active and fabric + partner are chosen, point them to Checkout (the estimate renders there from the design + selected fabric + partner). Don't fabricate prices.
- Match their energy. Short paragraphs. You suggest; they decide.

# Design tools (server-bound, write the maker's real design)
- analyze_product_image — vision read of a garment image + design directions.
- save_brief — validate the brief (product_type REQUIRED).
- create_design — create the design record NOW (registers a guest customer by email + links them). Call after brief + email, BEFORE generation.
- list_raw_materials — our fabrics (composition, color, swatch).
- list_partners — verified partners across the path (Fabric Seller → source, Manufacturer → make, Designer, Independent). Returns a SHORT list (6) by default; use a higher limit only when the maker asks to see everyone.
- generate_design_image — TWO A/B takes per call; requires an existing design + explicit maker consent; revision/layer build on the active take.
- set_active_canvas — record their pick; it becomes the design's thumbnail.
- get_design_state — board + brief state (call when resuming/editing).
- capture_contact — save their email as a lead.
- search_products — if they wander into shopping, search the catalogue (they may want a base product).
${hasProduct ? PRODUCT_CONTEXT(context!) : ""}${hasDesign ? DESIGN_CONTEXT(context!) : ""}

# Maker preferences (from onboarding)
${formatPrefs(prefs)}
${planDesignTurn(messages, context).directive}

Weave preferences into every generation (badges) and fabric/partner suggestions. If empty, ask at most one short question at a time.
`
}

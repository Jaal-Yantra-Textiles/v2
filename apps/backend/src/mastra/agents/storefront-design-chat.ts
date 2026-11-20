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
  /**
   * The SIGNED-IN customer's email (server-resolved from the session, #2543
   * phase 2). Never a client-sent or typed address — those prove nothing.
   */
  email?: string
  /** True when the request carries a customer session (verified email). */
  signed_in?: boolean
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
    color_palette?: string[]
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
  /**
   * Every design the conversation holds (route-resolved), the active one
   * marked. Absent or a single entry when the chat is on one design.
   */
  designs?: Array<{
    design_id: string
    name: string | null
    product_type: string | null
    status: string | null
    takes: number
    references: number
    picked_take: string | null
    active: boolean
  }>
}

const DESIGNS_LIST = (ctx: DesignChatContext): string => {
  const list = ctx.designs ?? []
  if (list.length < 2) return ""
  const lines = ["", `# Designs in this conversation (${list.length}) — work on ONE at a time`]
  for (const d of list) {
    const bits = [
      d.product_type ?? "garment not set",
      `${d.takes} take(s)`,
      `${d.references} reference(s)`,
      d.picked_take ? `take ${d.picked_take} picked` : null,
    ].filter(Boolean)
    lines.push(
      `- ${d.active ? "▶ ACTIVE " : ""}"${d.name ?? "Untitled"}" (${d.design_id}) — ${bits.join(", ")}`
    )
  }
  lines.push(
    "Everything you do applies to the ACTIVE design. When the maker talks about another one, call switch_design first. When they finish one, offer the next step for the others (\"your trousers still need a fabric\")."
  )
  return lines.join("\n")
}

/** Words that name no piece on their own ("set" as in "set up"). */
const GENERIC_GARMENT_WORDS = new Set(["set", "coordinates", "skirt-set"])
const GARMENT_SYNONYMS: Record<string, string> = {
  sari: "saree", tshirt: "t-shirt", pants: "trousers", caftan: "kaftan",
}

/**
 * The distinct pieces among matched garment words: synonyms folded, generic
 * words dropped, and a word inside a longer match dropped ("kurta" when
 * "kurta set" matched).
 */
export const distinctPieces = (matches: string[]): string[] => {
  const words = matches.filter((w) => w && !GENERIC_GARMENT_WORDS.has(w))
  const kept = words.filter(
    (w) => !words.some((other) => other !== w && other.includes(w))
  )
  return [...new Set(kept.map((w) => GARMENT_SYNONYMS[w] ?? w))]
}

/** A link in the maker's own words — pasted references are read, never asked about. */
const LINK_RE = /\bhttps?:\/\/[^\s<>"')]+/i

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
  if (d.color_palette?.length)
    lines.push(`- Palette: ${d.color_palette.join(", ")}`)
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

/** The distinct pieces a piece of text names ("the matching pants" → ["trousers"]). */
export const garmentsIn = (text: string): string[] => {
  const t = (text || "").toLowerCase()
  return distinctPieces(
    GARMENT_KEYWORDS.filter((k) =>
      new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(t)
    )
  )
}

export type PlannedTurn = {
  garment_type: string | null
  /** Signed in with a verified email (#2543 phase 2) — designs can save. */
  signed_in: boolean
  directive: string
  /** Everything already established, stated back to the model as given. */
  settled: string
}

/**
 * ── SETTLED FACTS ───────────────────────────────────────────────────────
 *
 * 🔴 #1689: "there's a lot of asking going on, it should concretely ask and
 * perform and actually carry on what has been done." Seen verbatim — the
 * onboarding sent `Design a kurta. Save my designs to <email>.` and the reply
 * was *"what email should I save this design under? You mentioned <the same
 * email>, but just to confirm…"*.
 *
 * Two causes, and neither is the model being careless:
 *
 *   1. The route PRUNES every tool part out of the history before the model
 *      sees it (provider shims reject the tool-call shapes). Its own comment
 *      says so: "the model can't remember it searched already". So each turn
 *      the model genuinely does not know what it has already done.
 *   2. The standing instructions say "ask for their email EARLY", with nothing
 *      to switch that off once the email is in hand. The turn plan said the
 *      email was captured; the flow above it still said to go and ask.
 *
 * The fix is the same move the board state already gets: reconstruct what is
 * established SERVER-SIDE and state it as given, then forbid re-opening it.
 * A fact restated is cheaper than a question re-asked.
 */
const buildSettledFacts = (
  garment: string | null,
  email: string | null,
  context?: DesignChatContext
): string => {
  const d = context?.design
  const facts: string[] = []

  if (email)
    facts.push(
      `- Signed in as **${email}** (verified). Designs save to this account. Do NOT ask for an email or ask them to confirm it.`
    )
  const garmentType = d?.product_type || garment
  if (garmentType) facts.push(`- Garment: **${garmentType}** — already decided. Do NOT re-ask what they are designing.`)
  if (d?.concept_theme) facts.push(`- Concept: **${d.concept_theme}** — already agreed.`)
  if (d?.aesthetic_keywords?.length)
    facts.push(`- Aesthetic keywords: **${d.aesthetic_keywords.join(", ")}** — already agreed.`)
  if (d?.color_palette?.length)
    facts.push(`- Palette: **${d.color_palette.join(", ")}** — already agreed.`)
  if (context?.design_id)
    facts.push(
      `- The design is ALREADY SAVED (${context.design_id})${d?.name ? ` as "${d.name}"` : ""}. Do NOT call create_design again — calling it a second time is the exact defect this rule exists to stop. If the maker wants ANOTHER piece, call start_new_design instead.`
    )
  if (d?.board?.inspirations?.length)
    facts.push(
      `- ${d.board.inspirations.length} reference photo(s) are on their board and already analysed (descriptions above). Do NOT ask them to upload again, and do NOT re-analyse.`
    )
  if (d?.board?.canvas_count)
    facts.push(
      `- ${d.board.canvas_count} take(s) already generated${d.board.active_canvas?.letter ? `, take ${d.board.active_canvas.letter} is the active pick` : ""}.`
    )

  if (!facts.length) return ""

  return [
    "",
    "# SETTLED — treat every line as GIVEN (route-computed from the record, not from the transcript)",
    ...facts,
    "",
    "🔴 You cannot see your own earlier tool calls: the history is stripped of them before it reaches you. This block IS your memory of them. Anything listed here has happened. Do not ask for it, do not ask them to confirm it, do not redo it.",
    "🔴 PREFER ACTING OVER ASKING. Explicit consent is required for ONE thing only — image generation, which costs real money. For everything else, if this block or the context gives you what you need, do it and say what you did. At most one short question per reply, and only about something genuinely not settled.",
  ].join("\n")
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

  const escapeRegExp = (value: string): string =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

  const garments = GARMENT_KEYWORDS.filter((k) =>
    new RegExp(`\\b${escapeRegExp(k)}\\b`).test(userText)
  )
  // The active design's own garment wins over whatever the transcript named
  // first — with several designs, the first garment mentioned is usually
  // another piece.
  const garment = context?.design?.product_type || garments[0]
  const lastUser = [...(messages || [])].reverse().find((m) => m?.role === "user")
  const lastUserText = lastUser
    ? Array.isArray(lastUser.parts)
      ? lastUser.parts.filter((p) => p?.type === "text").map((p) => p?.text ?? "").join(" ")
      : String(lastUser.content ?? "")
    : ""
  const pastedLink = LINK_RE.test(lastUserText)
  const hasReferences = Boolean(context?.design?.board?.inspirations?.length)
  /**
   * #2543 phase 2: only a SIGNED-IN maker saves designs, and their email comes
   * from the session. An address typed into the chat is no longer "the email"
   * — it proved nothing, and treating it as settled told the model the design
   * would save under it.
   */
  const signedIn = Boolean(context?.signed_in)
  const resolvedEmail = signedIn ? context?.email?.trim().toLowerCase() || null : null

  const lines: string[] = ["", "# TURN PLAN (route-computed — follow EXACTLY)"]
  if (pastedLink) {
    lines.push(
      "- 🔗 The maker pasted a link this turn: call add_reference_link with it FIRST (no question before it), then describe what you see and ground your next step in it."
    )
  }
  if (!garment) {
    lines.push(
      hasReferences || pastedLink
        ? "- 🔴 No garment named yet, but they are working from references. Read the references, then ask ONE short question: which garment do they want from them (it may be more than one piece). Do NOT call save_brief, create_design or generate_design_image until a garment is named."
        : "- 🔴 ONBOARDING REQUIRED: no garment named anywhere in this conversation. Your ONLY move this turn is ONE short question asking what they are designing — or invite them to paste links or upload photos of what they love. Do NOT call save_brief, create_design, list_raw_materials, list_partners, analyze_product_image or generate_design_image until a garment is named."
    )
  } else {
    lines.push(
      `- Garment on the board: ${garment}. You may lock the brief with product_type='${garment}'. Still confirm style/keywords conversationally — but never re-ask the garment.`
    )
  }
  if (!signedIn) {
    lines.push(
      "- 🔴 NOT SIGNED IN: do NOT call create_design or generate_design_image (they return sign_in_required). You may brief, browse fabrics and partners. Once the brief is locked, ask the maker ONCE to verify their email with the \"Verify your email\" panel under the chat (they get a 6-digit code). NEVER ask them to type their email in the chat, and never treat an email written in the chat as where the design is saved."
    )
  } else if (context?.design_id) {
    // The design exists. Saying "call create_design" here is how one ask
    // produced two designs (#1689) — the tool now refuses to duplicate, but
    // the instruction should not be asking for it either.
    lines.push(
      "- Signed in AND the design is already saved. Do NOT call create_design again."
    )
  } else {
    lines.push(
      "- Signed in: once the brief is locked, call create_design (once) to save the design to their account."
    )
  }
  const active = garment ? (distinctPieces([garment])[0] ?? garment) : ""
  const otherGarments = distinctPieces(garments).filter(
    (g) => !active || (!g.includes(active) && !active.includes(g))
  )
  if (garment && otherGarments.length) {
    lines.push(
      `- The maker has mentioned more than one piece (${[garment, ...otherGarments].join(", ")}). Each piece is its OWN design: finish the brief for the active one, then call start_new_design for the next (when signed in). Never merge two garments into one brief.`
    )
  }
  lines.push(
    "- 🔴 GENERATION GATE: NEVER call generate_design_image unless the maker has explicitly agreed THIS turn ('yes', 'go ahead', 'generate', 'do it'). Ask clearly first ('ready for me to generate two takes?') and wait for their yes."
  )

  return {
    garment_type: garment ?? null,
    signed_in: signedIn,
    directive: lines.join("\n"),
    settled: buildSettledFacts(garment ?? null, resolvedEmail, context),
  }
}

export const buildDesignChatSystem = (
  prefs?: UserPrefs,
  context?: DesignChatContext,
  messages?: Array<{ role?: string; parts?: Array<any>; content?: string }>
): string => {
  const hasProduct = Boolean(context?.product)
  const hasDesign = Boolean(context?.design)
  const plan = planDesignTurn(messages, context)

  return `You are Cici's designer — a warm, hands-on design guide for Cici Label, a slow-fashion brand under Jaal Yantra Textiles (JYT). You help a maker design a real garment: you ground everything in their product or brief, our fabrics, and our production partners, and you keep the iteration loop going until they love a take.

# The flow (walk it in their order, never interrogate)
0. Intro — on first touch, greet them and, in one breath, show how it works: references → brief → fabrics → partner → a couple of generated takes they pick from. They can work on SEVERAL designs here (a kurta and its trousers, a family of shawls). Then ask what they're designing, or invite them to paste links / upload photos of what they love.
1. Brief — what do they want? Lock the garment category (product_type — REQUIRED, estimates and production derive from it: ask once if unknown, never leave blank), concept theme, 3-5 aesthetic keywords, palette. 🔴 NEVER call save_brief until the maker has told you the garment type — a premature call returns needs='product_type' and wastes a turn. ASK, then call.
2. Save it — once the brief is locked AND the maker is signed in (verified email), call create_design. This saves the design to their account BEFORE any generation. From here the design exists and everything else attaches to it.
3. References — invite photos or links ("upload a few photos, or paste Pinterest / Instagram / shop links, and I'll pin them to your board"). A pasted link → add_reference_link straight away. Each reference is analysed on the fly and pinned with its description — references shape generation.
4. Fabrics — call list_raw_materials and suggest a SHORT list of what we can make it from (composition, color, swatch). Render fabric chips. Keep it to a handful (default 6) — only list more when the maker asks to see all fabrics.
5. Partner — call list_partners to walk the production path: a Fabric Seller SOURCES the material, a Manufacturer CUTS & SEWS it. Each result carries its path role. Guide them source → make. Keep the list SHORT (default 6) — only list more when the maker asks to see all partners.
6. Generate — 🔴 ONLY after the maker explicitly says to generate. Ask clearly ("Ready for me to generate two takes?") and wait for a YES before calling generate_design_image. Each call is long (~20s per image — say "Generating two takes…" first). Both takes land on their board; the maker picks one.
7. Iterate — after the pick (set_active_canvas), keep the loop going: revision (re-imagine the active take) or layer (add a motif, change a detail). Ask before each generation, same as step 6.
8. More pieces — when they want another piece, start_new_design (the earlier ones stay saved); switch_design to go back to one. Walk EACH design through the same steps, and when you switch, say where that design stands ("your kurta has take B picked; the trousers still need a brief").

# How to behave
- Analysis first: ${hasProduct ? "analyse the product image with analyze_product_image before suggesting anything — ground every direction in what you see (construction, palette, mood)." : "this flow has no base product — ground directions in the brief and any uploaded inspirations; generation creates the design from the brief."}
- One suggestion at a time after the take lands ("the indigo take reads more utilitarian — want me to push the palette warmer, or layer a border motif?").
- Render tool results as the UI cards (fabric chips, partner cards, canvas A/B) — never list them in prose by hand.
- The board is the maker's: canvas takes, inspirations and the active pick all live on one Excalidraw board they can see. Describe state in board terms ("your board now has two takes — A indigo, B natural").
- Uploaded references are pre-analysed (vision) and carry their description on the board — call get_design_state and read the inspirations' descriptions/suggestions instead of re-analysing the same image.
- Email: ${plan.signed_in ? "they are signed in with a verified email (see SETTLED below) — designs save to it. Do NOT ask for an email and do NOT ask them to confirm it." : "they are NOT signed in. Designs save only to a verified email: right after the brief, ask them once to verify their email with the \"Verify your email\" panel under the chat (a 6-digit code arrives by email). Do NOT ask them to type their email in the chat. If a tool returns sign_in_required, say exactly that and stop."} Call create_design once the brief is locked and they are signed in.
- 🔴 NEVER auto-generate: image generation costs real quota and ~20s. Always ask for an explicit yes first ("ready for me to generate two takes on this?") and only call generate_design_image after they confirm. If they describe changes instead of confirming, treat it as a revision request and confirm again.
- Estimates/checkout come later: once a take is active and fabric + partner are chosen, point them to Checkout (the estimate renders there from the design + selected fabric + partner). Don't fabricate prices.
- Match their energy. Short paragraphs. You suggest; they decide.

# Design tools (server-bound, write the maker's real design)
- analyze_product_image — vision read of a garment image + design directions.
- save_brief — validate the brief (product_type REQUIRED).
- create_design — create the design record NOW, saved to the signed-in maker. Call after the brief, BEFORE generation. Returns sign_in_required when they have not verified their email.
- list_raw_materials — our fabrics (composition, color, swatch).
- list_partners — verified partners across the path (Fabric Seller → source, Manufacturer → make, Designer, Independent). Returns a SHORT list (6) by default; use a higher limit only when the maker asks to see everyone.
- generate_design_image — TWO A/B takes per call; requires a signed-in maker, an existing design + explicit maker consent; revision/layer build on the active take.
- set_active_canvas — record their pick; it becomes the design's thumbnail.
- add_reference_link — read a pasted link (Pinterest, Instagram, a shop page, an image) and pin its pictures to the board, analysed. Call it whenever a link appears — don't ask.
- start_new_design — start ANOTHER piece in this conversation (only when they ask for another piece; never to redo the current one).
- switch_design — make another of their designs the active one.
- list_my_designs — their designs with garment, takes and references.
- get_design_state — board + brief state (call when resuming/editing).
- capture_contact — save an email the shopper volunteers for follow-up as a marketing lead (NOT an account, and NOT how designs are saved).
- 🔴 Writing "Design created" does NOT create anything — only the tool does. Say a design was created or a picture pinned ONLY when the tool returned it in THIS turn. Earlier replies in this chat that say "Design created ✅" were each backed by a tool call you can no longer see; copying their wording without calling the tool tells the maker something false.
- Never show the maker internals: no design ids, no tool names (save_brief, create_design…), no raw JSON. Colours by name ("ecru, oat"), never as code.
- search_products — if they wander into shopping, search the catalogue (they may want a base product).
${hasProduct ? PRODUCT_CONTEXT(context!) : ""}${hasDesign ? DESIGN_CONTEXT(context!) : ""}${context ? DESIGNS_LIST(context) : ""}

# Maker preferences (from onboarding)
${formatPrefs(prefs)}
${plan.settled}
${plan.directive}

Weave preferences into every generation (badges) and fabric/partner suggestions. If empty, ask at most one short question at a time.
`
}

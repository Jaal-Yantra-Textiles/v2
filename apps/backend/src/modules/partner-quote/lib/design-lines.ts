import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import designPartnersLink from "../../../links/design-partners-link"

/**
 * Quoting a DESIGN rather than a variant (#1486).
 *
 * ## Why this is a resolver and not a second pricing path
 *
 * A design has `estimated_cost`, `material_cost` and `production_cost`. None of
 * them is a price: they are what the work costs us, in `cost_currency`, with no
 * margin, no tier and no FX. Quoting off them would be a second, parallel way
 * to arrive at a number the buyer pays — and the whole point of
 * `plan-quote-prices` is that there is exactly one.
 *
 * So a design line is resolved to the VARIANT the design is sold through, and
 * everything downstream — tiers, the price list, freight weight, the accepted
 * cart — is the machinery that already exists and is already tested. The
 * `design_id` rides along on the line as provenance, so the quote knows it was
 * a design that was picked and both UIs can say so.
 *
 * ## Two links, two meanings
 *
 * - `design_product_variant` — one-to-one, the custom variant created FROM this
 *   design (`create-product-from-design`). Unambiguous, so it wins.
 * - `product_design` — many-to-many at product level, a design used in a
 *   catalogue product. A product has N variants, so this resolves to a LIST.
 *
 * 🔴 When the list has more than one entry the design is NOT resolved. Picking
 * the first would quote a size or colour nobody chose, at a price that is
 * probably right, on a document the buyer signs off — the failure would be
 * invisible in every test that asserts a quote was produced. The partner picks,
 * or nothing is quoted.
 */

export type DesignVariantCandidate = {
  variant_id: string
  title: string | null
  sku: string | null
  product_id: string | null
  product_title: string | null
}

export type DesignResolution = {
  design_id: string
  design_name: string | null
  /**
   * The design is real AND this caller may quote it. False answers "not yours"
   * and "not there" identically, deliberately, so an id cannot be probed.
   *
   * 🔑 Distinct from `variant_id`: a design can be perfectly visible and still
   * not resolvable (no product behind it, or sold as several variants). A line
   * that already names its variant needs only the first fact.
   */
  visible: boolean
  /** The one variant to quote through, or null when that is not decidable. */
  variant_id: string | null
  /** Everything it COULD be quoted through. One entry means resolved. */
  candidates: DesignVariantCandidate[]
  /** Plain words for a partner. Null when `variant_id` is set. */
  reason: string | null
}

/**
 * Which variant, if any, each design can be quoted through.
 *
 * `partner_id` scopes it. Omit it only on the admin surface, where an admin
 * quotes on any partner's behalf and the variant is separately asserted to be
 * in that partner's sales channel.
 *
 * 🔑 BATCHED — five graph queries regardless of how many designs are asked
 * about, because this also backs the wizard's design picker. Resolving each
 * design in a loop is three round-trips per row, which is how a picker that
 * feels fine against a seed becomes unusable against a real catalogue.
 */
export async function resolveDesignVariants(
  scope: any,
  input: { design_ids: string[]; partner_id?: string | null }
): Promise<Map<string, DesignResolution>> {
  const out = new Map<string, DesignResolution>()
  const ids = Array.from(new Set((input.design_ids ?? []).filter(Boolean)))
  if (!ids.length) return out

  const query: any = scope.resolve(ContainerRegistrationKeys.QUERY)

  // Filtered by id. `filters: { id: undefined }` is NO filter, not "no rows"
  // (#1433) — an empty list must never become "every design on the platform",
  // which is why the empty case returned above rather than falling through.
  const { data: designs = [] } = await query.graph({
    entity: "design",
    fields: ["id", "name", "owner_partner_id", "status"],
    filters: { id: ids },
  })

  const found = new Map((designs as any[]).map((d) => [d.id, d]))

  // Which of these the partner is assigned to. One query, not one per design.
  let assigned = new Set<string>()
  if (input.partner_id) {
    const { data: links = [] } = await query.graph({
      entity: designPartnersLink.entryPoint,
      fields: ["design_id", "partner_id"],
      filters: { design_id: ids, partner_id: input.partner_id },
    })
    assigned = new Set((links as any[]).map((l) => l.design_id).filter(Boolean))
  }

  const visible = ids.filter((id) => {
    const design = found.get(id)
    if (!design) return false
    if (!input.partner_id) return true
    return design.owner_partner_id === input.partner_id || assigned.has(id)
  })

  const candidatesByDesign = await batchDesignVariantCandidates(query, visible)

  for (const designId of ids) {
    const design = found.get(designId)

    // 🔑 "not yours" and "not there" answer identically, deliberately, so an
    // id cannot be probed for existence.
    if (!design || !visible.includes(designId)) {
      out.set(designId, {
        design_id: designId,
        design_name: null,
        visible: false,
        variant_id: null,
        candidates: [],
        reason: `Design ${designId} does not exist.`,
      })
      continue
    }

    const candidates = candidatesByDesign.get(designId) ?? []

    out.set(designId, {
      design_id: designId,
      design_name: design.name ?? null,
      visible: true,
      variant_id: candidates.length === 1 ? candidates[0].variant_id : null,
      candidates,
      reason:
        candidates.length === 1
          ? null
          : candidates.length === 0
            ? `"${design.name ?? designId}" has no product behind it yet, so there is nothing to price. Create a product from the design first.`
            : `"${design.name ?? designId}" is sold as ${candidates.length} variants — pick the one to quote.`,
    })
  }

  return out
}

/** The custom variant first; a catalogue product's variants otherwise. */
async function batchDesignVariantCandidates(
  query: any,
  designIds: string[]
): Promise<Map<string, DesignVariantCandidate[]>> {
  const out = new Map<string, DesignVariantCandidate[]>()
  if (!designIds.length) return out

  // 1. The one-to-one custom variants. Unambiguous by construction, so a
  //    design that has one never falls through to its product's variant list.
  const { data: direct = [] } = await query.graph({
    entity: "design_product_variant",
    fields: ["design_id", "product_variant_id"],
    filters: { design_id: designIds },
  })

  const directByDesign = new Map<string, string[]>()
  for (const row of direct as any[]) {
    if (!row?.design_id || !row?.product_variant_id) continue
    const list = directByDesign.get(row.design_id) ?? []
    list.push(row.product_variant_id)
    directByDesign.set(row.design_id, list)
  }

  const directIds = Array.from(new Set([...directByDesign.values()].flat()))
  const describedDirect = await describeVariants(query, directIds)
  const directById = new Map(describedDirect.map((v) => [v.variant_id, v]))

  for (const [designId, variantIds] of directByDesign) {
    out.set(
      designId,
      variantIds.map((id) => directById.get(id)).filter(Boolean) as DesignVariantCandidate[]
    )
  }

  // 2. The catalogue products the remaining designs are used in.
  const remaining = designIds.filter((id) => !(out.get(id) ?? []).length)
  if (!remaining.length) return out

  const { data: productLinks = [] } = await query.graph({
    entity: "product_design",
    fields: ["design_id", "product_id"],
    filters: { design_id: remaining },
  })

  const productsByDesign = new Map<string, string[]>()
  for (const row of productLinks as any[]) {
    if (!row?.design_id || !row?.product_id) continue
    const list = productsByDesign.get(row.design_id) ?? []
    list.push(row.product_id)
    productsByDesign.set(row.design_id, list)
  }

  const productIds = Array.from(new Set([...productsByDesign.values()].flat()))
  if (!productIds.length) {
    for (const id of remaining) out.set(id, out.get(id) ?? [])
    return out
  }

  const { data: products = [] } = await query.graph({
    entity: "product",
    fields: ["id", "title", "variants.id", "variants.title", "variants.sku"],
    filters: { id: productIds },
  })

  const variantsByProduct = new Map<string, DesignVariantCandidate[]>(
    (products as any[]).map((p) => [
      p.id,
      ((p?.variants ?? []) as any[]).map((v) => ({
        variant_id: v.id,
        title: v.title ?? null,
        sku: v.sku ?? null,
        product_id: p.id ?? null,
        product_title: p.title ?? null,
      })),
    ])
  )

  for (const id of remaining) {
    out.set(
      id,
      (productsByDesign.get(id) ?? []).flatMap((pid) => variantsByProduct.get(pid) ?? [])
    )
  }

  return out
}

async function describeVariants(
  query: any,
  variantIds: string[]
): Promise<DesignVariantCandidate[]> {
  if (!variantIds.length) return []

  const { data: variants = [] } = await query.graph({
    entity: "product_variant",
    fields: ["id", "title", "sku", "product.id", "product.title"],
    filters: { id: variantIds },
  })

  return (variants as any[]).map((v) => ({
    variant_id: v.id,
    title: v.title ?? null,
    sku: v.sku ?? null,
    product_id: v.product?.id ?? null,
    product_title: v.product?.title ?? null,
  }))
}

/**
 * How this file reaches the made-to-order minter, without importing it.
 *
 * 🔑 An injected port rather than a direct call. This module is unit-tested
 * with no Medusa runtime — `applyDesignResolutions` and friends are pure — and
 * importing the workflow would drag the workflow SDK, the product-creation core
 * flow and `model.define()` into that test's module graph. A lazy `await
 * import()` was the other option and is worse: `--moduleResolution nodenext`
 * demands a `.js` specifier that the dev transpiler may not resolve back to the
 * `.ts` file, and a failed import inside quote creation is a 500 on the one
 * route this feature exists to unblock.
 *
 * The routes own the wiring; `makeDesignVariantPort` builds one.
 */
export type DesignVariantPort = (input: {
  design_id: string
  /** Answer without creating anything. The readiness preflight passes true. */
  dry_run: boolean
}) => Promise<{
  variant_id: string | null
  unit_price: number | null
  confidence: string | null
  basis: string | null
  reason: string | null
} | null>

export type QuoteLineInput = {
  variant_id?: string | null
  design_id?: string | null
  quantity: number
  [key: string]: any
}

/**
 * PURE: is this product one the quote flow MINTED for a design, on a line that
 * actually named that design?
 *
 * ## Why the question has two halves
 *
 * `create-product-from-design` stamps `metadata.is_custom_design` on everything
 * it makes, and that alone is not enough. A partner can put a custom-design
 * product on a plain variant line, with no `design_id` anywhere — nothing in
 * the design machinery runs for that line, so nothing would attach the
 * catalogue link, and calling it "pending" would be a promise no code keeps.
 *
 * 🔴 And the metadata half cannot be dropped either. A design that resolves
 * through `product_design` points at a REAL catalogue product belonging to
 * whoever owns that catalogue. Treating that as attachable would let one
 * partner's quote silently add another partner's product to its own sales
 * channel — a cross-tenant catalogue write, which is the family of failure
 * `assertVariantsInStore` was written for (#1419).
 *
 * So: minted for a design AND quoted as a design. Both, or the ordinary
 * refusal stands.
 */
export function isMadeToOrderDesignProduct(
  product: { metadata?: Record<string, any> | null } | null | undefined,
  quotedFromADesignLine: boolean
): boolean {
  if (!quotedFromADesignLine) return false
  return product?.metadata?.is_custom_design === true
}

/**
 * PURE: fold resolutions into the basket, and collect every failure.
 *
 * 🔑 Every failure, not the first. A partner fixing a five-line basket one
 * error per round-trip is how a wizard stops being used — the readiness
 * preflight already made this promise for variants and this keeps it for
 * designs.
 *
 * An explicit `variant_id` always wins: the partner has already answered the
 * question the resolution exists to answer, which is how a multi-variant design
 * gets quoted at all.
 */
export function applyDesignResolutions(
  lines: QuoteLineInput[],
  resolutions: Map<string, DesignResolution>
): { lines: QuoteLineInput[]; errors: string[] } {
  const errors: string[] = []

  const resolved = (lines ?? []).map((line) => {
    const designId = line.design_id ? String(line.design_id) : null
    if (!designId) return line

    const resolution = resolutions.get(designId)
    if (!resolution) {
      errors.push(`Design ${designId} could not be looked up.`)
      return line
    }

    if (line.variant_id) {
      /**
       * Both given — the design is provenance, the variant is the choice
       * (#1501). The variant is NEVER overwritten: attaching a design to a
       * line the partner already chose must not silently move the line to a
       * different SKU.
       *
       * 🔴 But it is still asserted VISIBLE, which it was not before. A line
       * that named its own variant skipped design resolution entirely, so any
       * string at all could be frozen onto a commercial document as its
       * design — including another partner's design id. Nothing rendered it,
       * which is the only reason it was not a leak; an unchecked foreign id on
       * a signed document is the #1496 family and does not get to wait for a
       * renderer to make it real.
       *
       * Visibility, not resolvability: a design with no product behind it, or
       * one sold as several variants, is a perfectly good ANSWER to "which
       * design is this" once the variant is already chosen. Only the resolving
       * path needs it narrowed to one.
       */
      if (!resolution.visible) {
        errors.push(resolution.reason ?? `Design ${designId} does not exist.`)
      }
      return line
    }

    if (!resolution.variant_id) {
      errors.push(resolution.reason ?? `Design ${designId} cannot be quoted.`)
      return line
    }

    return { ...line, variant_id: resolution.variant_id }
  })

  return { lines: resolved, errors }
}


/**
 * Mint a made-to-order variant for every design in the basket that has no
 * product behind it. Returns whether anything was actually created.
 *
 * ⚠️ The workflow is imported LAZILY, and that is not a style choice. This file
 * is unit-tested without a Medusa runtime — `applyDesignResolutions` and
 * friends are pure — and a top-level import would pull the workflow SDK, the
 * product-creation core flow and `model.define()` into that test's module
 * graph. The estimator resolves its own dependency by string key for exactly
 * the same reason.
 *
 * 🔑 Failures are collected per design and left to the resolver to report. A
 * design that could not be priced comes back with no variant, and
 * `applyDesignResolutions` already knows how to say so — throwing here would
 * refuse the whole basket for one unpriceable line, and the promise this file
 * makes is that a partner sees EVERY problem at once.
 */
async function mintMissingDesignVariants(input: {
  resolutions: Map<string, DesignResolution>
  lines: QuoteLineInput[]
  port: DesignVariantPort
}): Promise<boolean> {
  const needing = designsNeedingAVariant(input.lines, input.resolutions)
  if (!needing.length) return false

  let mintedAny = false
  for (const designId of needing) {
    try {
      const result = await input.port({ design_id: designId, dry_run: false })
      if (result?.variant_id) mintedAny = true
    } catch {
      /**
       * Left unresolved on purpose. A design that could not be minted comes
       * back with no variant and `applyDesignResolutions` already knows how to
       * say so — throwing here would refuse the whole basket over one line,
       * and the promise this file makes is that a partner sees EVERY problem
       * at once rather than one per round-trip.
       */
    }
  }

  return mintedAny
}

/**
 * PURE: which designs in this basket still need a variant minted.
 *
 * 🔴 Only lines with no `variant_id` of their own. A line that named its
 * variant is already answered, and minting for it would attach a SECOND
 * variant to the design — making it ambiguous, which is the one state that
 * cannot be quoted at all. The fix would create the bug.
 *
 * And only the no-candidate case. "Sold as several variants" is a question for
 * the partner; a freshly minted sixth variant does not answer it.
 */
export function designsNeedingAVariant(
  lines: QuoteLineInput[],
  resolutions: Map<string, DesignResolution>
): string[] {
  return Array.from(
    new Set(
      (lines ?? [])
        .filter((l) => l?.design_id && !l?.variant_id)
        .map((l) => String(l.design_id))
    )
  ).filter((id) => {
    const r = resolutions.get(id)
    return Boolean(r?.visible && !r.variant_id && r.candidates.length === 0)
  })
}

/**
 * Resolve a basket's design lines, or refuse the whole basket.
 *
 * Throws before anything is created — a design that cannot be priced must cost
 * nothing, exactly like a variant that does not exist.
 */
export async function resolveQuoteDesignLines(
  scope: any,
  input: {
    lines: QuoteLineInput[]
    partner_id?: string | null
    /**
     * Mints a made-to-order variant for a design that has no product behind
     * it, instead of the basket being refused.
     *
     * This IS the relaxation. A custom design whose production run is in the
     * future is the normal case for bespoke work, and telling a partner to go
     * and create a catalogue product for something nobody has bought yet is a
     * step that existed only because the resolver needed a variant to point
     * at. Omit the port and the old refusal is exactly what happens.
     *
     * Only the no-product case is minted. A design sold as several variants
     * still makes the partner choose.
     */
    variant_port?: DesignVariantPort | null
  }
): Promise<QuoteLineInput[]> {
  const designIds = (input.lines ?? [])
    // EVERY design named, not only the ones being resolved TO a variant: a
    // line that already has its variant still has to prove the design it
    // claims is one this caller may quote (#1501).
    .filter((l) => l?.design_id)
    .map((l) => String(l.design_id))

  if (!designIds.length) return input.lines ?? []

  let resolutions = await resolveDesignVariants(scope, {
    design_ids: designIds,
    partner_id: input.partner_id ?? null,
  })

  if (input.variant_port) {
    const minted = await mintMissingDesignVariants({
      resolutions,
      lines: input.lines,
      port: input.variant_port,
    })
    // Re-resolve rather than patching the map by hand: minting created a link,
    // and the resolver is the one thing that knows how to read it.
    if (minted) {
      resolutions = await resolveDesignVariants(scope, {
        design_ids: designIds,
        partner_id: input.partner_id ?? null,
      })
    }
  }

  const { lines, errors } = applyDesignResolutions(input.lines, resolutions)

  if (errors.length) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, errors.join(" "))
  }

  return lines
}

/**
 * The readiness form of the same resolution (#1445 + #1486).
 *
 * 🔑 The preflight REPORTS where the mint REFUSES. `assessQuoteReadiness`
 * exists so a partner sees every blocking reason at once instead of collecting
 * them one failed mint at a time, and a design with no product behind it is
 * exactly that kind of reason. Throwing here would make the preflight fail in a
 * different shape from every other problem it knows how to describe.
 *
 * Unresolved lines are DROPPED from the basket handed on to the assessment —
 * a line with no variant would otherwise be reported a second time as
 * `variant_missing`, which reads as two problems when there is one.
 */
export async function resolveDesignLinesForReadiness(
  scope: any,
  input: {
    lines: QuoteLineInput[]
    partner_id?: string | null
    /**
     * Previews what a design with no product would be quoted at. Called with
     * `dry_run: true`, so asking stays free of consequences.
     */
    variant_port?: DesignVariantPort | null
    /** Only for the message. The port owns the arithmetic. */
    currency_code?: string | null
  }
): Promise<{
  lines: QuoteLineInput[]
  issues: Array<{
    code: "design_unresolved" | "design_made_to_order"
    severity: "blocking" | "warning"
    message: string
    design_id: string | null
    data?: Record<string, unknown>
  }>
}> {
  const designIds = (input.lines ?? [])
    // EVERY design named, not only the ones being resolved TO a variant: a
    // line that already has its variant still has to prove the design it
    // claims is one this caller may quote (#1501).
    .filter((l) => l?.design_id)
    .map((l) => String(l.design_id))

  if (!designIds.length) return { lines: input.lines ?? [], issues: [] }

  const resolutions = await resolveDesignVariants(scope, {
    design_ids: designIds,
    partner_id: input.partner_id ?? null,
  })

  const { lines } = applyDesignResolutions(input.lines, resolutions)

  /**
   * Two different questions, so two different tests (#1501).
   *
   * A design on a line with NO variant must resolve to exactly one — that is
   * the whole job. A design attached to a line that already names its variant
   * only has to be one this caller may quote: "sold as 3 variants" is a fine
   * answer to "which design is this" when the variant is already chosen, and
   * reporting it as blocking would invent a problem the partner cannot fix
   * and did not have.
   */
  const resolvingIds = new Set(
    (input.lines ?? [])
      .filter((l) => l?.design_id && !l?.variant_id)
      .map((l) => String(l.design_id))
  )

  const unresolved = designIds
    .map((id) => resolutions.get(id))
    .filter((r): r is DesignResolution => {
      if (!r) return false
      return resolvingIds.has(r.design_id) ? !r.variant_id : !r.visible
    })

  /**
   * A design with NO product is no longer a problem — it is a made-to-order
   * line, and the preflight's job is to say so and show the price it would
   * carry.
   *
   * 🔑 Priced with `dry_run`, so opening the wizard creates nothing. The real
   * mint happens on the create route; if it fails there, the basket is refused
   * exactly as before.
   *
   * A design that STILL cannot be priced stays blocking, with the estimator's
   * own reason — "no bill of materials, no completed run and no comparable
   * work" is something a partner can act on; "cannot be quoted" is not.
   */
  const mintable = input.variant_port
    ? await previewMadeToOrderDesigns(unresolved, input.variant_port)
    : new Map<
        string,
        { unit_price: number | null; confidence: string | null; basis: string | null; reason: string | null }
      >()

  const issues = unresolved.map((r) => {
    const preview = mintable.get(r.design_id)

    if (preview?.unit_price != null) {
      return {
        code: "design_made_to_order" as const,
        severity: "warning" as const,
        message:
          `"${r.design_name ?? r.design_id}" has no product yet, so it will be quoted as made-to-order at ` +
          `${preview.unit_price} ${String(input.currency_code).toUpperCase()} per unit. ` +
          `That figure is a ${preview.confidence ?? "guesstimate"} — dial it in if you know better.`,
        design_id: r.design_id,
        data: {
          candidates: r.candidates,
          unit_price: preview.unit_price,
          confidence: preview.confidence,
          basis: preview.basis,
          made_to_order: true,
        },
      }
    }

    return {
      code: "design_unresolved" as const,
      severity: "blocking" as const,
      // The estimator's reason when there is one — it names what is missing.
      message: preview?.reason ?? r.reason ?? `Design ${r.design_id} cannot be quoted.`,
      design_id: r.design_id,
      // The candidate list IS the fix for the ambiguous case — the wizard shows
      // it as a picker rather than making the partner go and look it up.
      data: { candidates: r.candidates },
    }
  })

  return {
    lines: lines.filter((l) => Boolean(l.variant_id)),
    issues,
  }
}

/**
 * What each unpriceable-looking design WOULD be quoted at, without creating
 * anything. Only the no-product case is asked about: "sold as several
 * variants" is a choice for the partner and minting a sixth would not help.
 */
async function previewMadeToOrderDesigns(
  resolutions: DesignResolution[],
  port: DesignVariantPort
): Promise<
  Map<
    string,
    { unit_price: number | null; confidence: string | null; basis: string | null; reason: string | null }
  >
> {
  const out = new Map<
    string,
    { unit_price: number | null; confidence: string | null; basis: string | null; reason: string | null }
  >()

  // Only the no-product case is asked about — see `designsNeedingAVariant`.
  const candidates = resolutions.filter(
    (r) => r.visible && !r.variant_id && r.candidates.length === 0
  )
  if (!candidates.length) return out

  for (const r of candidates) {
    try {
      const result = await port({ design_id: r.design_id, dry_run: true })
      if (!result) continue
      out.set(r.design_id, {
        unit_price: result.unit_price ?? null,
        confidence: result.confidence ?? null,
        basis: result.basis ?? null,
        reason: result.reason ?? null,
      })
    } catch {
      // Falls through to the blocking issue with the resolver's own reason.
    }
  }

  return out
}

/**
 * Fold the design failures into the checklist the wizard renders.
 *
 * 🔑 `ready` is recomputed, not left alone. A basket whose only problem is an
 * unquotable design would otherwise come back `ready: true` with a blocking
 * row underneath it — and the mint would then refuse, which is precisely the
 * one-error-at-a-time experience the preflight exists to end.
 */
export function withDesignIssues(readiness: any, issues: any[]) {
  if (!issues?.length) return readiness
  const all = [...issues, ...(readiness?.issues ?? [])]
  const blocking = all.filter((i) => i.severity === "blocking").length
  return {
    ...readiness,
    issues: all,
    blocking_count: blocking,
    warning_count: all.length - blocking,
    ready: blocking === 0,
  }
}

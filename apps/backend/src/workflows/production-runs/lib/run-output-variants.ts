/**
 * One variant per size/colour a run actually made, and stock per line (#2271).
 *
 * `produced_output` says WHAT was made — `[{ size_label: "S", quantity: 1 },
 * { size_label: "M", quantity: 2 }]`. This turns each line into the variant it
 * is stocked as, creating the variant (and a DRAFT product, founder 2026-09-25)
 * when it does not exist yet.
 *
 * ## The option axes
 *
 * A design-minted product carries one option that answers "which design"
 * (#1874). Size and colour become two more, `Size` and `Color`, added the first
 * time a run makes a sized or coloured piece. Medusa requires every variant to
 * carry a value for every option of its product, so a variant that predates the
 * axis gets `Made to order` — which is what it is: the piece a customer orders
 * to spec, not one on a shelf. That keeps it purchasable.
 *
 * 🔴 A product SHARED with other designs is refused, not rearranged. Adding an
 * axis there would have to give every other design's variant a value too, and
 * those are not this run's to relabel. The goods stay unstocked with a reason,
 * and the repair job can bank them once the product is sorted out.
 *
 * Nothing here guesses a size. A run whose split is unknown never reaches this
 * module with lines; see `resolveProducedOutput`.
 */
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createAndLinkProductOptionsToProductWorkflow,
  createProductVariantsWorkflow,
} from "@medusajs/medusa/core-flows"

import { DESIGN_MODULE } from "../../../modules/designs"
import { computeRunCostSummary } from "../../../modules/production_runs/cost-summary"
import { loadCostConfig } from "../../../modules/platform-cost-config/read-config"
import { applyDesignProductPlan } from "../../designs/design-product-plan"
import { resolveApprovalCurrency, resolveApprovalPrice } from "../approval-pricing"
import { runOutputAxes, type OutputLine } from "./run-output"

export const SIZE_OPTION = "Size"
export const COLOR_OPTION = "Color"
export const MADE_TO_ORDER = "Made to order"

const AXES = [SIZE_OPTION, COLOR_OPTION] as const

type OptionValueRow = { value?: string | null; option?: { title?: string | null } | null }

export type PlanProduct = {
  id: string
  options?: Array<{ id: string; title: string; values?: Array<{ value?: string | null }> }>
  variants?: Array<{
    id: string
    sku?: string | null
    title?: string | null
    options?: OptionValueRow[] | null
    prices?: Array<{ amount?: number | null; currency_code?: string | null }> | null
  }>
}

export type PlannedLine = OutputLine & {
  /** The axis values this line is stocked under, e.g. { Size: "S" }. */
  axis_values: Record<string, string>
  /** Set when a variant already exists for this combination. */
  variant_id?: string
}

export type OutputVariantPlan =
  | {
      ok: true
      product_id: string
      /** Options the product does not have yet, with every value it needs. */
      add_options: Array<{ title: string; values: string[] }>
      /** New values on options the product already has. */
      add_values: Array<{ option_id: string; title: string; values: string[] }>
      /** Existing variants that need a value for a newly added axis. */
      backfill: Array<{ variant_id: string; options: Record<string, string> }>
      /** The design's own option values, copied onto every new variant. */
      base_options: Record<string, string>
      /** A template variant for title, sku and prices of new variants. */
      template_variant_id: string
      lines: PlannedLine[]
    }
  | {
      ok: false
      reason: "no_design_variant" | "shared_product" | "ambiguous_design_variants"
      detail: string
    }

/** PURE: a variant's options as { title: value }. */
export function variantOptionMap(
  options: OptionValueRow[] | null | undefined
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const o of options ?? []) {
    const title = o?.option?.title
    if (title && o?.value != null) out[title] = String(o.value)
  }
  return out
}

/**
 * PURE: what has to exist for these lines, and which variant each is.
 *
 * `designVariantIds` are the variants linked to THIS design. Every other
 * variant on the product belongs to someone else.
 */
export function planOutputVariants(input: {
  product: PlanProduct
  designVariantIds: string[]
  lines: OutputLine[]
}): OutputVariantPlan {
  const { product } = input
  const designIds = new Set(input.designVariantIds)
  const variants = product.variants ?? []
  const designVariants = variants.filter((v) => designIds.has(v.id))
  const foreign = variants.filter((v) => !designIds.has(v.id))

  if (!designVariants.length) {
    return {
      ok: false,
      reason: "no_design_variant",
      detail: `product ${product.id} has no variant linked to this design`,
    }
  }

  const needsAxis: Record<string, boolean> = {
    [SIZE_OPTION]: input.lines.some((l) => !!l.size_label),
    [COLOR_OPTION]: input.lines.some((l) => !!l.color),
  }
  const productOptions = product.options ?? []
  const optionByTitle = new Map(productOptions.map((o) => [o.title, o]))
  const axisPresent = (t: string) => optionByTitle.has(t)
  const axesInPlay = AXES.filter((t) => needsAxis[t] || axisPresent(t))

  if (foreign.length && AXES.some((t) => needsAxis[t] && !axisPresent(t))) {
    return {
      ok: false,
      reason: "shared_product",
      detail:
        `product ${product.id} also carries ${foreign.length} variant(s) of other designs; ` +
        `adding ${AXES.filter((t) => needsAxis[t] && !axisPresent(t)).join("/")} would relabel them`,
    }
  }

  /** The design's identity options: everything that is not a size/colour axis. */
  const template = designVariants[0]
  const base_options: Record<string, string> = {}
  for (const [title, value] of Object.entries(variantOptionMap(template.options))) {
    if (!(AXES as readonly string[]).includes(title)) base_options[title] = value
  }

  const valueFor = (line: OutputLine, axis: string): string =>
    axis === SIZE_OPTION
      ? line.size_label || MADE_TO_ORDER
      : line.color || MADE_TO_ORDER

  const add_options: Array<{ title: string; values: string[] }> = []
  const add_values: Array<{ option_id: string; title: string; values: string[] }> = []
  const backfill: Array<{ variant_id: string; options: Record<string, string> }> = []

  for (const axis of axesInPlay) {
    const wanted = new Set(input.lines.map((l) => valueFor(l, axis)))
    const existing = optionByTitle.get(axis)
    if (!existing) {
      // Every existing variant gets MADE_TO_ORDER on the new axis.
      wanted.add(MADE_TO_ORDER)
      add_options.push({ title: axis, values: [...wanted] })
    } else {
      const have = new Set((existing.values ?? []).map((v) => String(v?.value ?? "")))
      const missing = [...wanted].filter((v) => !have.has(v))
      if (missing.length) add_values.push({ option_id: existing.id, title: axis, values: missing })
    }
  }

  // Existing variants gain a value for each NEW axis, keeping all they have.
  const newAxes = add_options.map((o) => o.title)
  if (newAxes.length) {
    for (const v of variants) {
      const current = variantOptionMap(v.options)
      const next = { ...current }
      for (const axis of newAxes) next[axis] = MADE_TO_ORDER
      backfill.push({ variant_id: v.id, options: next })
    }
  }

  /** A design variant's axis values as they will stand after the backfill. */
  const axisValuesAfter = (v: (typeof variants)[number]): Record<string, string> => {
    const current = variantOptionMap(v.options)
    const out: Record<string, string> = {}
    for (const axis of axesInPlay) out[axis] = current[axis] ?? MADE_TO_ORDER
    return out
  }

  const lines: PlannedLine[] = []
  for (const line of input.lines) {
    const axis_values: Record<string, string> = {}
    for (const axis of axesInPlay) axis_values[axis] = valueFor(line, axis)

    const matches = designVariants.filter((v) => {
      const after = axisValuesAfter(v)
      return axesInPlay.every((axis) => after[axis] === axis_values[axis])
    })

    if (matches.length > 1) {
      return {
        ok: false,
        reason: "ambiguous_design_variants",
        detail:
          `${matches.length} variants of this design match ` +
          `${JSON.stringify(axis_values) || "the unsized piece"}: ${matches.map((m) => m.id).join(", ")}`,
      }
    }

    lines.push({ ...line, axis_values, variant_id: matches[0]?.id })
  }

  return {
    ok: true,
    product_id: product.id,
    add_options,
    add_values,
    backfill,
    base_options,
    template_variant_id: template.id,
    lines,
  }
}

export type StockLine = PlannedLine & { variant_id: string; inventory_item_id: string }

/**
 * Carry out a plan: add axes and values, backfill, create missing variants and
 * link them to the design. Returns every line with its variant and inventory
 * item.
 *
 * Idempotent by construction: a second call re-plans against the product as it
 * now stands, finds the variants the first call made, and creates nothing.
 */
export async function applyOutputVariantPlan(
  container: any,
  input: { design_id: string; plan: Extract<OutputVariantPlan, { ok: true }>; product: PlanProduct }
): Promise<StockLine[]> {
  const { plan, product } = input
  const productService: any = container.resolve(Modules.PRODUCT)
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK)

  if (plan.add_options.length || plan.add_values.length) {
    await createAndLinkProductOptionsToProductWorkflow(container).run({
      input: {
        product_id: plan.product_id,
        add: plan.add_options.map((o) => ({ title: o.title, values: o.values })) as any,
        update: plan.add_values.map((o) => ({
          product_option_id: o.option_id,
          add: o.values.map((value) => ({ value })),
        })),
      },
    })
  }

  for (const b of plan.backfill) {
    await productService.updateProductVariants(b.variant_id, { options: b.options })
  }

  const template = (product.variants ?? []).find((v) => v.id === plan.template_variant_id)
  const prices = (template?.prices ?? [])
    .filter((p) => p?.currency_code && p?.amount != null)
    .map((p) => ({ amount: Number(p.amount), currency_code: String(p.currency_code) }))
  const baseSku = String(template?.sku ?? `CUSTOM-${input.design_id}`)
  const baseTitle = String(template?.title ?? "")

  const toCreate = plan.lines.filter((l) => !l.variant_id)
  const created = new Map<string, string>()
  if (toCreate.length) {
    const suffixOf = (l: PlannedLine) =>
      Object.values(l.axis_values).filter((v) => v !== "Made to order")
    const { result } = await createProductVariantsWorkflow(container).run({
      input: {
        product_variants: toCreate.map((l) => ({
          product_id: plan.product_id,
          title: [baseTitle, ...suffixOf(l)].filter(Boolean).join(" / "),
          sku: [baseSku, ...suffixOf(l).map((s) => s.toUpperCase().replace(/\s+/g, "-"))].join("-"),
          manage_inventory: true,
          options: { ...plan.base_options, ...l.axis_values },
          prices,
          metadata: { is_custom_design: true, design_id: input.design_id },
        })) as any,
      },
    })
    for (const [i, v] of (result ?? []).entries()) {
      const line = toCreate[i]
      if (!v?.id || !line) continue
      created.set(JSON.stringify(line.axis_values), v.id)
      await remoteLink.create({
        [DESIGN_MODULE]: { design_id: input.design_id },
        [Modules.PRODUCT]: { product_variant_id: v.id },
        data: { created_at: new Date() },
      })
    }
  }

  const out: StockLine[] = []
  for (const line of plan.lines) {
    const variantId = line.variant_id ?? created.get(JSON.stringify(line.axis_values))
    if (!variantId) {
      throw new Error(`variant for ${JSON.stringify(line.axis_values)} was not created`)
    }
    const { data } = await query.graph({
      entity: "product_variant_inventory_item",
      filters: { variant_id: variantId },
      fields: ["inventory_item_id"],
    })
    const inventoryItemId = data?.[0]?.inventory_item_id
    if (!inventoryItemId) {
      throw new Error(`variant ${variantId} has no inventory item to stock`)
    }
    out.push({ ...line, variant_id: variantId, inventory_item_id: inventoryItemId })
  }
  return out
}

/** Read the product and the design's variant ids in the shape the planner takes. */
export async function readPlanInputs(
  container: any,
  input: { design_id: string; product_id: string }
): Promise<{ product: PlanProduct; designVariantIds: string[] }> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: products } = await query.graph({
    entity: "product",
    filters: { id: input.product_id },
    fields: [
      "id",
      "options.id",
      "options.title",
      "options.values.value",
      "variants.id",
      "variants.sku",
      "variants.title",
      "variants.options.value",
      "variants.options.option.title",
      "variants.prices.amount",
      "variants.prices.currency_code",
    ],
  })
  const { data: links } = await query.graph({
    entity: "design_product_variant",
    filters: { design_id: input.design_id },
    fields: ["product_variant_id"],
  })
  return {
    product: (products?.[0] ?? { id: input.product_id }) as PlanProduct,
    designVariantIds: (links ?? [])
      .map((l: any) => l?.product_variant_id)
      .filter(Boolean) as string[],
  }
}

/**
 * Bank each line at the location. Returns what was banked, for the rollback
 * and the #891 audit record.
 */
export async function bankStockLines(
  container: any,
  input: { location_id: string; lines: Array<{ inventory_item_id: string; quantity: number }> }
): Promise<Array<{ inventory_item_id: string; location_id: string; quantity: number }>> {
  const inventoryService: any = container.resolve(Modules.INVENTORY)
  const banked: Array<{ inventory_item_id: string; location_id: string; quantity: number }> = []
  for (const line of input.lines) {
    if (!(line.quantity > 0)) continue
    const [existing] = await inventoryService.listInventoryLevels({
      inventory_item_id: line.inventory_item_id,
      location_id: input.location_id,
    })
    if (existing) {
      await inventoryService.updateInventoryLevels({
        inventory_item_id: line.inventory_item_id,
        location_id: input.location_id,
        stocked_quantity: (existing.stocked_quantity || 0) + line.quantity,
      })
    } else {
      await inventoryService.createInventoryLevels({
        inventory_item_id: line.inventory_item_id,
        location_id: input.location_id,
        stocked_quantity: line.quantity,
      })
    }
    banked.push({
      inventory_item_id: line.inventory_item_id,
      location_id: input.location_id,
      quantity: line.quantity,
    })
  }
  return banked
}

/* -------------------------------------------------------------------------
 * Which path a completed run's goods take
 * ---------------------------------------------------------------------- */

export type RunStockTarget =
  /** The pre-#2271 single-variant path — unchanged for everything it served. */
  | { mode: "legacy" }
  /** One variant per produced line; `product_id` is what the lines sit on. */
  | { mode: "lines"; product_id: string; lines: StockLine[]; minted_product: boolean }
  /** Goods exist and nothing can be banked honestly. Never a guess. */
  | { mode: "skip"; reason: string }

/**
 * PURE: does this run need the per-line path at all?
 *
 * Only two cases do: the run made a sized/coloured piece, or its design has no
 * product yet (the founder's call: mint a DRAFT at completion). Everything else
 * — a run naming its own variant, a customer-order run, an approved stamp, a
 * sizeless design that already has its variant — keeps the path it had.
 */
export function needsLinePath(input: {
  run: {
    variant_id?: string | null
    approved_variant_id?: string | null
    order_id?: string | null
    order_line_item_id?: string | null
  }
  lines: OutputLine[] | null
  axesStated: boolean
  designHasProduct: boolean
}): "legacy" | "lines" | "split_unknown" {
  const { run } = input
  if (run.variant_id || run.order_id || run.order_line_item_id) return "legacy"
  if (input.axesStated && !input.lines) return "split_unknown"
  const sized = (input.lines ?? []).some((l) => !!l.size_label || !!l.color)
  if (sized) return "lines"
  if (run.approved_variant_id) return "legacy"
  return input.designHasProduct ? "legacy" : "lines"
}

/**
 * The design's product: the one its variants sit on. Several → null, never
 * row 0 of them (#2059's lottery).
 */
async function resolveDesignProductId(container: any, designId: string): Promise<{
  product_id: string | null
  ambiguous: boolean
}> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: links } = await query.graph({
    entity: "design_product_variant",
    filters: { design_id: designId },
    fields: ["product_variant_id"],
  })
  const variantIds = (links ?? []).map((l: any) => l?.product_variant_id).filter(Boolean)
  if (!variantIds.length) return { product_id: null, ambiguous: false }
  const { data: variants } = await query.graph({
    entity: "product_variant",
    filters: { id: variantIds },
    fields: ["id", "product_id"],
  })
  const ids = Array.from(
    new Set((variants ?? []).map((v: any) => v?.product_id).filter(Boolean))
  ) as string[]
  return ids.length === 1
    ? { product_id: ids[0], ambiguous: false }
    : { product_id: null, ambiguous: ids.length > 1 }
}

/**
 * Mint a DRAFT product for a design that has none, priced as output approval
 * would price it (run cost x markup, else the design estimate). Approval later
 * finds and reuses it.
 */
async function mintDraftProduct(
  container: any,
  run: { id: string; design_id: string }
): Promise<{ product_id: string } | { reason: string }> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: designs } = await query.graph({
    entity: "design",
    filters: { id: run.design_id },
    fields: ["id", "estimated_cost", "cost_currency"],
  })
  const design = designs?.[0]
  if (!design) return { reason: `design ${run.design_id} not found` }

  let runCostPerUnit: number | null = null
  let runCurrency: string | null = null
  try {
    const summary = await computeRunCostSummary(container, run.id)
    const perUnit = Number(summary?.cost_per_unit)
    if (Number.isFinite(perUnit) && perUnit > 0) {
      runCostPerUnit = perUnit
      runCurrency = (summary as any)?.currency ?? null
    }
  } catch {
    // An uncostable run falls back to the design estimate, as approval does.
  }

  const costConfig = await loadCostConfig(container)
  const priced = resolveApprovalPrice({
    runCostPerUnit,
    designEstimatedCost: Number(design.estimated_cost ?? 0),
    markup: (costConfig as any)?.approval_markup_multiplier ?? undefined,
  })
  if (!priced) {
    return {
      reason:
        `design ${run.design_id} has no product and cannot be priced: no costed ` +
        `consumption on the run and no estimated_cost on the design`,
    }
  }
  const currency = resolveApprovalCurrency({
    runCurrency: priced.source === "run_cost" ? runCurrency : null,
    designCurrency: design.cost_currency,
  })

  try {
    const minted = await applyDesignProductPlan(container, {
      design_id: run.design_id,
      estimated_cost: priced.price,
      currency_code: currency,
    })
    return minted?.product_id
      ? { product_id: minted.product_id }
      : { reason: `minting a draft product for design ${run.design_id} returned nothing` }
  } catch (e: any) {
    return { reason: `could not mint a draft product: ${e?.message ?? e}` }
  }
}

/**
 * Where a completed run's good units go. See `RunStockTarget`.
 *
 * `allowMint: false` is for a caller that must not create catalogue rows (a
 * preview).
 */
export async function resolveRunStockTarget(
  container: any,
  input: {
    run: {
      id: string
      design_id?: string | null
      variant_id?: string | null
      approved_variant_id?: string | null
      order_id?: string | null
      order_line_item_id?: string | null
      snapshot?: unknown
      produced_output?: unknown
    }
    good_quantity: number
    allowMint?: boolean
    /**
     * Whether the partner has a warehouse. Without one the per-line path mints
     * nothing and banks nothing — the run still completes, as it did before
     * #2271 for a design with no product. Minting a product and then refusing
     * the completion would block every partner still missing a location
     * (13 on prod, #2053) on work they have finished.
     */
    has_location?: boolean
  }
): Promise<RunStockTarget> {
  const { run } = input
  if (!(input.good_quantity > 0) || !run.design_id) return { mode: "legacy" }

  const axes = runOutputAxes(run.snapshot)
  const lines = Array.isArray(run.produced_output)
    ? (run.produced_output as OutputLine[])
    : null
  const designProduct = await resolveDesignProductId(container, run.design_id)

  const path = needsLinePath({
    run,
    lines,
    axesStated: axes.sizes.length > 1 || axes.colors.length > 1,
    designHasProduct: !!designProduct.product_id || designProduct.ambiguous,
  })
  if (path === "legacy") return { mode: "legacy" }
  if (input.has_location === false) {
    return {
      mode: "skip",
      reason: "the partner has no stock location — link one, then bank with the bank-unstocked-run job",
    }
  }
  if (path === "split_unknown") {
    return {
      mode: "skip",
      reason:
        `run ${run.id} is for ${[...axes.sizes, ...axes.colors].join(", ")} and nobody ` +
        `said which were made; record produced_output, then bank it`,
    }
  }

  if (designProduct.ambiguous) {
    return { mode: "skip", reason: `design ${run.design_id}'s variants sit on several products` }
  }

  let productId = designProduct.product_id
  let minted = false
  if (!productId) {
    if (input.allowMint === false) {
      return { mode: "skip", reason: `design ${run.design_id} has no product (preview does not mint)` }
    }
    const mint = await mintDraftProduct(container, { id: run.id, design_id: run.design_id })
    if ("reason" in mint) return { mode: "skip", reason: mint.reason }
    productId = mint.product_id
    minted = true
  }

  const effectiveLines: OutputLine[] = lines?.length
    ? lines
    : [{ size_label: null, color: null, quantity: input.good_quantity }]

  const { product, designVariantIds } = await readPlanInputs(container, {
    design_id: run.design_id,
    product_id: productId,
  })
  const plan = planOutputVariants({ product, designVariantIds, lines: effectiveLines })
  if (!plan.ok) return { mode: "skip", reason: `${plan.reason}: ${plan.detail}` }

  const stockLines = await applyOutputVariantPlan(container, {
    design_id: run.design_id,
    plan,
    product,
  })
  return { mode: "lines", product_id: productId, lines: stockLines, minted_product: minted }
}

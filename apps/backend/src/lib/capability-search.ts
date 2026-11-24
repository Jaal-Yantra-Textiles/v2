/**
 * #2596 — "who can do this step?" and "build me a recipe", without AI.
 *
 * Evidence (samples) comes from Medusa's index engine, searched with the
 * SAMPLE as the root entity: only then does free text (`q`) reach the
 * sample's own words ("acrylic", "gusset"). Rates are read LIVE from the
 * module, never from the index, because the index lags writes and a price
 * must not be stale.
 *
 * A partner with a rate but no sample photo still counts — a rate quoted on a
 * call is evidence too.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { PARTNER_CAPABILITY_MODULE } from "../modules/partner_capability"
import { getTechnique, TECHNIQUES } from "../modules/partner_capability/lib/techniques"

const STALE_AFTER_DAYS = 180

type Container = { resolve: (k: string) => any }

export type CapabilitySearchInput = {
  /** A slug from lib/techniques.ts. */
  technique?: string
  /** Substring, case-insensitive ("cotton" matches "kala cotton"). */
  material?: string
  product_type?: string
  /** Free text over the samples' own words. */
  q?: string
  /** For picking the right quantity band on each rate. */
  quantity?: number
  limit?: number
}

export type RateView = {
  id: string
  technique: string
  unit: string
  min_qty: number | null
  max_qty: number | null
  currency_code: string
  price_low: number
  price_high: number | null
  setup_fee: number | null
  lead_days: number | null
  tax_basis: string
  source: string
  status: string
  observed_at: string
  /** Older than ~6 months: "recheck" before quoting. */
  stale: boolean
  /** Holds for the requested quantity (true when no quantity was given). */
  fits_quantity: boolean
}

export type PartnerMatch = {
  partner: { id: string; name: string; handle?: string }
  evidence: { id: string; title: string; technique: string | null; material: string | null; product_type: string | null; captured_at: string | null }[]
  rates: RateView[]
  /** No confirmed rate that fits → the quote shows "ask". */
  needs_rate: boolean
}

const num = (v: unknown) => (v == null ? null : Number(v))

const toRateView = (r: any, quantity?: number): RateView => {
  const observed = new Date(r.observed_at)
  return {
    id: r.id,
    technique: r.technique,
    unit: r.unit,
    min_qty: r.min_qty ?? null,
    max_qty: r.max_qty ?? null,
    currency_code: r.currency_code,
    price_low: Number(r.price_low),
    price_high: num(r.price_high),
    setup_fee: num(r.setup_fee),
    lead_days: r.lead_days ?? null,
    tax_basis: r.tax_basis,
    source: r.source,
    status: r.status,
    observed_at: observed.toISOString(),
    stale: Date.now() - observed.getTime() > STALE_AFTER_DAYS * 86_400_000,
    fits_quantity:
      quantity == null ||
      ((r.min_qty == null || quantity >= r.min_qty) && (r.max_qty == null || quantity <= r.max_qty)),
  }
}

export const searchCapabilities = async (
  container: Container,
  input: CapabilitySearchInput
): Promise<PartnerMatch[]> => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const service = container.resolve(PARTNER_CAPABILITY_MODULE)
  const limit = Math.min(input.limit ?? 50, 200)

  const filters: Record<string, unknown> = {}
  if (input.technique) filters.technique_slug = input.technique
  if (input.material) filters.material = { $ilike: `%${input.material}%` }
  if (input.product_type) filters.product_type = { $ilike: `%${input.product_type}%` }
  if (input.q) filters.q = input.q

  const byPartner = new Map<string, PartnerMatch>()

  const hasSampleFilter = Object.keys(filters).length > 0
  if (hasSampleFilter) {
    const { data } = await query.index({
      entity: "partner_capability_sample",
      fields: [
        "id", "title", "technique", "technique_slug", "material", "product_type", "captured_at",
        "partner.id", "partner.name", "partner.handle",
      ],
      filters: filters as any,
      pagination: { take: limit * 4 },
    })
    for (const s of data as any[]) {
      if (!s.partner?.id) continue
      const m: PartnerMatch = byPartner.get(s.partner.id) ?? {
        partner: { id: s.partner.id, name: s.partner.name, handle: s.partner.handle },
        evidence: [],
        rates: [],
        needs_rate: true,
      }
      m.evidence.push({
        id: s.id,
        title: s.title,
        technique: s.technique ?? null,
        material: s.material ?? null,
        product_type: s.product_type ?? null,
        captured_at: s.captured_at ? new Date(s.captured_at).toISOString() : null,
      })
      byPartner.set(s.partner.id, m)
    }
  }

  // Live rates. With a technique, partners who only have a rate also count.
  if (input.technique) {
    const rates = await service.listPartnerCapabilityRates(
      { technique: input.technique },
      { take: limit * 4, order: { observed_at: "DESC" } }
    )
    const missing = [...new Set<string>(rates.map((r: any) => r.partner_id))].filter(
      (id) => !byPartner.has(id)
    )
    // A material/q filter narrows to partners with matching EVIDENCE; a bare
    // rate can't prove the material, so it only joins a technique-only search.
    const techniqueOnly = !input.material && !input.product_type && !input.q
    if (missing.length && techniqueOnly) {
      const { data: partners } = await query.graph({
        entity: "partner",
        fields: ["id", "name", "handle"],
        filters: { id: missing },
      })
      for (const p of partners as any[]) {
        byPartner.set(p.id, { partner: { id: p.id, name: p.name, handle: p.handle }, evidence: [], rates: [], needs_rate: true })
      }
    }
    for (const r of rates) {
      const m = byPartner.get(r.partner_id)
      if (m) m.rates.push(toRateView(r, input.quantity))
    }
  }

  const out = [...byPartner.values()]
  for (const m of out) {
    m.needs_rate = !m.rates.some((r) => r.status === "confirmed" && r.fits_quantity)
  }
  // Partners with a usable rate first, then by how much evidence they have.
  out.sort(
    (a, b) =>
      Number(a.needs_rate) - Number(b.needs_rate) ||
      b.evidence.length + b.rates.length - (a.evidence.length + a.rates.length)
  )
  return out.slice(0, limit)
}

export type RecipeStepInput = { technique: string; material?: string }

export type RecipeStep = {
  technique: string
  label: string
  material: string | null
  partners: PartnerMatch[]
  /** Nobody can do it → sourcing (#2600). */
  gap: boolean
  alternatives: { technique: string; label: string; partner_count: number }[]
}

/**
 * Each step is one search; code assembles the recipe. Alternatives are
 * counted too, so "try hand painting instead" only appears with a number
 * of partners behind it.
 */
export const previewRecipe = async (
  container: Container,
  steps: RecipeStepInput[],
  opts: { quantity?: number } = {}
): Promise<RecipeStep[]> =>
  Promise.all(
    steps.map(async (step) => {
      const def = getTechnique(step.technique)
      const partners = await searchCapabilities(container, {
        technique: step.technique,
        material: step.material,
        quantity: opts.quantity,
      })
      const alternatives = await Promise.all(
        (def?.alternatives ?? []).map(async (slug) => ({
          technique: slug,
          label: getTechnique(slug)?.label ?? slug,
          partner_count: (await searchCapabilities(container, { technique: slug, quantity: opts.quantity })).length,
        }))
      )
      return {
        technique: step.technique,
        label: def?.label ?? step.technique,
        material: step.material ?? null,
        partners,
        gap: partners.length === 0,
        alternatives,
      }
    })
  )

export const techniqueVocabulary = () => TECHNIQUES

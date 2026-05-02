type Segment = {
  id: string
  title?: string
  description?: string | null
  image_url?: string | null
  duration_minutes?: number | null
  time_slot?: string | null
  base_price?: number
  currency?: string
  required?: boolean
  optional?: boolean
  depends_on?: string[]
}

type Pricing = {
  currency?: string
  per_category_multiplier?: Record<string, number>
}

export type ComputedCost = {
  currency: string
  total_pax: number
  subtotal: number
  by_segment: Array<{
    id: string
    title?: string
    base_price: number
    pax: number
    line_total: number
  }>
}

export type PaymentSummary = {
  paid_via_source: {
    provider: string
    amount: number
    currency: string
    raw: string | null
  } | null
  add_ons_due: number
  add_ons_currency: string
  // Total only when paid + add-ons share a currency. When they differ, the
  // server can't sum them — the frontend has FX rates and reconciles into
  // the traveller's local currency.
  total: number | null
  total_currency: string | null
}

/**
 * GYG exports prices like "20000.00 INR" — split into amount + currency.
 */
export function parseGygPrice(raw: unknown): { amount: number; currency: string } | null {
  if (typeof raw !== "string" || !raw.trim()) return null
  const m = raw.trim().match(/^([\d,]+(?:\.\d+)?)\s*([A-Z]{3})$/)
  if (!m) return null
  const amount = parseFloat(m[1].replace(/,/g, ""))
  if (!Number.isFinite(amount)) return null
  return { amount, currency: m[2] }
}

export function buildPaymentSummary(
  metadata: Record<string, any> | null | undefined,
  computed: ComputedCost
): PaymentSummary {
  const gyg = (metadata as any)?.gyg
  const paid = parseGygPrice(gyg?.price)

  const addOnsCurrency = computed.currency
  const sameCurrency = !!paid && paid.currency === addOnsCurrency

  return {
    paid_via_source: paid
      ? {
          provider: typeof gyg?.booking_ref === "string" ? "GYG" : "Source",
          amount: paid.amount,
          currency: paid.currency,
          raw: typeof gyg?.price === "string" ? gyg.price : null,
        }
      : null,
    add_ons_due: computed.subtotal,
    add_ons_currency: addOnsCurrency,
    // Server-side sum only when currencies match. When they differ
    // (common: GYG paid in INR, add-ons priced in EUR), the frontend
    // reconciles using live FX rates.
    total: sameCurrency
      ? Math.round(((paid?.amount ?? 0) + computed.subtotal) * 100) / 100
      : null,
    total_currency: sameCurrency ? addOnsCurrency : null,
  }
}

export function getSegments(form: any): Segment[] {
  const raw = form?.settings?.itinerary_segments
  if (!Array.isArray(raw)) return []
  return raw.filter((s) => s && typeof s.id === "string")
}

export function getPricing(form: any): Pricing {
  return (form?.settings?.pricing as Pricing) || {}
}

export function computeHeadcount(
  headcount: Record<string, number> | undefined,
  pricing: Pricing
): { total_pax: number; weighted_pax: number } {
  const counts = headcount || {}
  const mult = pricing.per_category_multiplier || {}

  let total_pax = 0
  let weighted_pax = 0
  for (const [cat, n] of Object.entries(counts)) {
    if (typeof n !== "number" || n <= 0) continue
    total_pax += n
    const m = typeof mult[cat] === "number" ? mult[cat] : 1
    weighted_pax += n * m
  }
  return { total_pax, weighted_pax }
}

export function computeCost(
  form: any,
  selectedSegmentIds: string[],
  headcount: Record<string, number> | undefined
): ComputedCost {
  const segments = getSegments(form)
  const pricing = getPricing(form)
  const currency = pricing.currency || segments[0]?.currency || "INR"

  const selected = new Set(selectedSegmentIds)
  // Required segments are always included even if not in the user's selection.
  const effective = segments.filter(
    (s) => selected.has(s.id) || s.required === true
  )

  const { total_pax, weighted_pax } = computeHeadcount(headcount, pricing)
  const pax = weighted_pax || total_pax || 1

  const by_segment = effective.map((s) => {
    const base = typeof s.base_price === "number" ? s.base_price : 0
    return {
      id: s.id,
      title: s.title,
      base_price: base,
      pax,
      line_total: Math.round(base * pax * 100) / 100,
    }
  })

  const subtotal =
    Math.round(by_segment.reduce((acc, l) => acc + l.line_total, 0) * 100) / 100

  return {
    currency,
    total_pax,
    subtotal,
    by_segment,
  }
}

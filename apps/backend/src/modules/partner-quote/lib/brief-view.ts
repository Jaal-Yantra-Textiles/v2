/**
 * #2608 S1 — what a quote brief shows: options, the partners per step with
 * their sample photos, and an ESTIMATE built from live rates.
 *
 * 🔑 An estimate is not a price. Every figure here is labelled as one, rates
 * are read live (never frozen onto the brief), and a step without a rate says
 * "we'll confirm" rather than contributing ₹0. A step nobody can do says
 * "we're exploring partners" and is still shown.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { PARTNER_CAPABILITY_MODULE } from "../../partner_capability"
import { getTechnique } from "../../partner_capability/lib/techniques"
import { attachCapabilityMedia } from "../../../workflows/partner/capability-media"
import { fetchExchangeRate } from "../../../lib/fx/exchange-rate"
import { loadPartnerProfile } from "../../../api/store/custom/partners/profile-lib/load-profile"
import { timelineOption } from "./brief-timeline"
import { houseStorefrontOrigin } from "./quote-link"
import { producerStorefrontUrl } from "./quote-producer"

const STALE_AFTER_DAYS = 180

export const ESTIMATE_DISCLAIMER =
  "Estimates only, from the workshops' recent rates. Not a confirmed price: we confirm every figure before you pay anything."

export type RateLike = {
  id: string
  unit: string
  currency_code: string
  price_low: number
  price_high: number | null
  setup_fee: number | null
  min_qty: number | null
  max_qty: number | null
  lead_days: number | null
  status: string
  observed_at: string | Date
}

export type ChoiceEstimate = {
  /** Per piece, in the rate's currency. */
  low: number
  high: number
  currency_code: string
  unit: string
  qty_per_piece: number
  setup_fee: number | null
  lead_days: number | null
  /** `confirmed` rate vs a `proposed` one nobody has checked yet. */
  rate_confirmed: boolean
  stale: boolean
}

/** One choice's per-piece estimate, or null when it has no usable rate. */
export const estimateChoice = (
  rate: RateLike | null | undefined,
  qtyPerPiece: number | null | undefined,
  now: Date = new Date()
): ChoiceEstimate | null => {
  if (!rate) return null
  const low = Number(rate.price_low)
  if (!Number.isFinite(low)) return null
  // `??`, not `||`: a 0 is a real number here and must not become 1.
  const q = qtyPerPiece != null && Number(qtyPerPiece) > 0 ? Number(qtyPerPiece) : 1
  const high = rate.price_high != null ? Number(rate.price_high) : low
  return {
    low: round2(low * q),
    high: round2(high * q),
    currency_code: String(rate.currency_code).toLowerCase(),
    unit: rate.unit,
    qty_per_piece: q,
    setup_fee: rate.setup_fee != null ? Number(rate.setup_fee) : null,
    lead_days: rate.lead_days ?? null,
    rate_confirmed: rate.status === "confirmed",
    stale: now.getTime() - new Date(rate.observed_at).getTime() > STALE_AFTER_DAYS * 86_400_000,
  }
}

export type StepForEstimate = {
  label: string
  selected_choice_id: string | null
  choices: { id: string; estimate: ChoiceEstimate | null }[]
}

export type OptionEstimate = {
  currency_code: string
  per_piece_low: number
  per_piece_high: number
  /** One-time setup fees across the steps counted. */
  setup_total: number
  /** For the buyer's quantity, when she has given one. */
  total_low: number | null
  total_high: number | null
  quantity: number | null
  /** Steps that add to the price but have no figure yet. */
  pending_steps: string[]
  /** Every step has a figure. Still an estimate. */
  complete: boolean
  /** Some figure rests on a rate nobody has confirmed. */
  has_unconfirmed: boolean
  /** Rates in another currency were left out rather than converted. */
  skipped_currency: string[]
}

/**
 * Sum one option's steps.
 *
 * A step counts the buyer's chosen partner; with no pick, the range across
 * every partner that has a rate (cheapest low, dearest high), so the range is
 * honest about the choice still open.
 */
export const estimateOption = (
  steps: StepForEstimate[],
  currencyCode: string,
  quantity: number | null
): OptionEstimate => {
  const currency = currencyCode.toLowerCase()
  let low = 0
  let high = 0
  let setup = 0
  let hasUnconfirmed = false
  const pending: string[] = []
  const skipped = new Set<string>()

  for (const step of steps) {
    const picked = step.selected_choice_id
      ? step.choices.filter((c) => c.id === step.selected_choice_id)
      : step.choices
    const priced = picked
      .map((c) => c.estimate)
      .filter((e): e is ChoiceEstimate => !!e)
    const usable = priced.filter((e) => {
      if (e.currency_code !== currency) {
        skipped.add(e.currency_code)
        return false
      }
      return true
    })
    if (!usable.length) {
      pending.push(step.label)
      continue
    }
    low += Math.min(...usable.map((e) => e.low))
    high += Math.max(...usable.map((e) => e.high))
    setup += Math.max(0, ...usable.map((e) => e.setup_fee ?? 0))
    if (usable.some((e) => !e.rate_confirmed)) hasUnconfirmed = true
  }

  const qty = quantity != null && quantity > 0 ? quantity : null
  return {
    currency_code: currency,
    per_piece_low: round2(low),
    per_piece_high: round2(high),
    setup_total: round2(setup),
    total_low: qty ? round2(low * qty + setup) : null,
    total_high: qty ? round2(high * qty + setup) : null,
    quantity: qty,
    pending_steps: pending,
    complete: pending.length === 0,
    has_unconfirmed: hasUnconfirmed,
    skipped_currency: [...skipped],
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * What a buyer can truthfully tell HER customers about each craft. Plain facts
 * about the technique, never claims about a particular workshop (no "fair
 * trade", no "100 years old") that nobody has checked.
 */
export const TECHNIQUE_STORY: Record<string, string> = {
  hand_spinning: "Yarn spun by hand on a charkha before it ever reaches the loom.",
  handloom_weaving: "Woven by hand on a loom, thread by thread. Small irregularities are the mark of the hand, not a fault.",
  powerloom_weaving: "Woven on a power loom for an even, consistent cloth.",
  knitting: "Knitted stitch by stitch.",
  natural_dyeing: "Coloured with plant-based dyes, so shades vary a little from batch to batch.",
  chemical_dyeing: "Dyed to a fixed recipe for steady, repeatable colour.",
  tie_dye: "Patterned by tying the cloth before it is dyed, so no two pieces come out the same.",
  block_print: "Printed by hand with carved wooden blocks, one stamp and one colour at a time.",
  screen_print: "Printed by hand through a mesh screen, one colour at a time.",
  digital_print: "Printed digitally, for fine detail and many colours.",
  hand_painting: "Painted by hand by an artist, so every piece is one of a kind.",
  hand_embroidery: "Embroidered by hand, stitch by stitch.",
  machine_embroidery: "Embroidered by machine for crisp, repeatable detail.",
  stitching: "Cut and stitched by hand in a small workshop.",
  finishing: "Finished by hand: washed, pressed and checked piece by piece.",
  pattern_making: "Patterned and graded by hand before cutting.",
}

export type BriefFx = {
  base_currency: string
  display_currency: string
  /** 1 base = rate display. Null when no conversion happened. */
  rate: number | null
  converted: boolean
  /** Why it was not converted, when it wasn't. */
  reason: string | null
}

/** Convert every money figure in a built brief view, in place. Pure. */
export const convertBriefMoney = (view: any, rate: number, to: string) => {
  const c = (n: number | null | undefined) => (n == null ? n : round2(n * rate))
  for (const o of view.options ?? []) {
    for (const s of o.steps ?? []) {
      for (const ch of s.choices ?? []) {
        if (!ch.estimate) continue
        ch.estimate = { ...ch.estimate, low: c(ch.estimate.low), high: c(ch.estimate.high), setup_fee: c(ch.estimate.setup_fee), currency_code: to }
      }
    }
    const e = o.estimate
    o.estimate = {
      ...e,
      currency_code: to,
      per_piece_low: c(e.per_piece_low),
      per_piece_high: c(e.per_piece_high),
      setup_total: c(e.setup_total),
      total_low: c(e.total_low),
      total_high: c(e.total_high),
    }
  }
  view.currency_code = to
  return view
}

/** The currency of the region that serves `country`, or null. */
const regionCurrency = async (query: any, country: string | null | undefined): Promise<string | null> => {
  const cc = String(country ?? "").trim().toLowerCase()
  if (!/^[a-z]{2}$/.test(cc)) return null
  const { data } = await query.graph({ entity: "region", fields: ["currency_code", "countries.iso_2"] })
  const region = (data as any[]).find((r) => (r.countries ?? []).some((x: any) => x.iso_2 === cc))
  return region?.currency_code?.toLowerCase() ?? null
}

const quantityAnswer = (questions: any[]): number | null => {
  const q = questions.find((x) => x.key === "quantity")
  const n = q?.answer != null ? Number(q.answer) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Load a brief with everything the page needs. `audience: "buyer"` drops
 * internal fields (token hash, rate ids, created_by).
 */
export const buildBriefView = async (
  container: any,
  briefId: string,
  opts: { audience: "buyer" | "admin"; country?: string | null } = { audience: "buyer" }
) => {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const capability: any = container.resolve(PARTNER_CAPABILITY_MODULE)

  const { data } = await query.graph({
    entity: "partner_quote_brief",
    fields: [
      "*",
      "options.*",
      "options.steps.*",
      "options.steps.choices.*",
      "questions.*",
      "updates.*",
    ],
    filters: { id: briefId },
  })
  const brief = (data as any[])[0]
  if (!brief) return null

  const options = [...(brief.options ?? [])].sort(byPosition)
  const choices = options.flatMap((o: any) => (o.steps ?? []).flatMap((s: any) => s.choices ?? []))

  const partnerIds = [...new Set<string>([brief.partner_id, ...choices.map((c: any) => c.partner_id)])]
  const rateIds = [...new Set<string>(choices.map((c: any) => c.rate_id).filter(Boolean))]
  const sampleIds = [...new Set<string>(choices.flatMap((c: any) => (Array.isArray(c.sample_ids) ? c.sample_ids : [])))]

  // Every read filtered by id — an empty id list must not become "no filter".
  const [partners, rates, samples] = await Promise.all([
    partnerIds.length
      ? query
          .graph({
            entity: "partners",
            fields: ["id", "name", "handle", "is_public", "status", "storefront_domain", "custom_domain", "custom_domain_verified"],
            filters: { id: partnerIds },
          })
          .then((r: any) => r.data as any[])
      : [],
    rateIds.length ? capability.listPartnerCapabilityRates({ id: rateIds }) : [],
    sampleIds.length
      ? capability
          .listPartnerCapabilitySamples({ id: sampleIds })
          .then((rows: any[]) => attachCapabilityMedia(container, rows))
      : [],
  ])
  const partnerById = new Map<string, any>((partners as any[]).map((p) => [p.id, p]))

  /**
   * The workshops' PUBLIC profiles (#2444) — only partners who switched
   * `is_public` on; everyone else is shown by name only. Links: their page on
   * our main storefront, and their own store when they have one.
   */
  const country = String(opts.country ?? brief.destination_country_code ?? "").toLowerCase()
  const houseOrigin = houseStorefrontOrigin()
  const profileById = new Map<string, any>()
  {
    const offered = new Set<string>(choices.map((c: any) => c.partner_id))
    await Promise.all(
      [...partnerById.values()]
        .filter((p) => offered.has(p.id))
        .map(async (p) => {
          const store_url = (() => {
            try {
              return producerStorefrontUrl(p)
            } catch {
              return null
            }
          })()
          let profile: any = null
          if (p.is_public && p.handle) {
            profile = await loadPartnerProfile(container, p.handle, []).catch(() => null)
          }
          profileById.set(p.id, {
            store_url,
            profile_url: profile && houseOrigin && country ? `${houseOrigin}/${country}/partners/${encodeURIComponent(p.handle)}` : null,
            tagline: profile?.tagline ?? null,
            about: profile?.about ? String(profile.about).slice(0, 400) : null,
            cover_image: profile?.cover_image ?? null,
            logo: profile?.logo ?? null,
            team_size: profile?.team_size ?? null,
            roles: profile?.roles ?? [],
            pieces_made: profile?.making?.pieces_made ?? 0,
            making_since: profile?.making?.making_since ?? null,
            photos: (profile?.capabilities ?? []).flatMap((c: any) => (c.images ?? []).map((i: any) => i.url)).slice(0, 6),
          })
        })
    )
  }
  const rateById = new Map<string, any>((rates as any[]).map((r) => [r.id, r]))
  const sampleById = new Map<string, any>((samples as any[]).map((s) => [s.id, s]))

  const questions = [...(brief.questions ?? [])].sort(byPosition)
  const quantity = quantityAnswer(questions)
  const deadlineRaw = questions.find((q: any) => q.key === "deadline")?.answer
  const deadlineAnswer = typeof deadlineRaw === "string" ? deadlineRaw : null
  const now = new Date()

  const optionViews = options.map((o: any) => {
    const steps = [...(o.steps ?? [])].sort(byPosition).map((s: any) => {
      const stepChoices = [...(s.choices ?? [])].sort(byPosition).map((c: any) => {
        const rate = c.rate_id ? rateById.get(c.rate_id) : null
        const partner = partnerById.get(c.partner_id)
        return {
          id: c.id,
          partner: {
            id: c.partner_id,
            name: partner?.name?.trim() || "Partner workshop",
            handle: partner?.handle ?? null,
            ...(profileById.get(c.partner_id) ?? { store_url: null, profile_url: null, photos: [], roles: [] }),
          },
          note: c.note ?? null,
          estimate: estimateChoice(rate, s.qty_per_piece, now),
          samples: (Array.isArray(c.sample_ids) ? c.sample_ids : [])
            .map((id: string) => sampleById.get(id))
            .filter(Boolean)
            .map((x: any) => ({
              id: x.id,
              title: x.title,
              material: x.material ?? null,
              photos: (x.media ?? []).map((m: any) => m.url).filter(Boolean),
            })),
          ...(opts.audience === "admin" ? { rate_id: c.rate_id ?? null } : {}),
        }
      })
      return {
        id: s.id,
        label: s.label,
        kind: s.kind,
        technique: s.technique ?? null,
        technique_label: getTechnique(s.technique)?.label ?? null,
        qty_per_piece: s.qty_per_piece ?? null,
        lead_days: s.lead_days ?? null,
        note: s.note ?? null,
        selected_choice_id: s.selected_choice_id ?? null,
        /** none = "we're exploring partners"; ask = partners but no figure yet. */
        state: !stepChoices.length
          ? ("exploring" as const)
          : stepChoices.some((c: any) => c.estimate)
            ? ("estimated" as const)
            : ("ask" as const),
        choices: stepChoices,
      }
    })
    return {
      id: o.id,
      title: o.title,
      description: o.description ?? null,
      buyer_selected: !!o.buyer_selected,
      steps,
      estimate: estimateOption(steps, brief.currency_code, quantity),
      timeline: timelineOption(steps as any, brief.sample_days ?? null, deadlineAnswer, now),
      story: {
        headline: o.story ?? null,
        points: steps
          .filter((s: any) => s.technique && TECHNIQUE_STORY[s.technique])
          .map((s: any) => {
            const picked = s.choices.find((c: any) => c.id === s.selected_choice_id)
            const makers = picked ? [picked] : s.choices
            return {
              label: s.label,
              text: TECHNIQUE_STORY[s.technique],
              by: s.state === "exploring" ? null : makers.map((c: any) => c.partner.name),
            }
          }),
      },
    }
  })

  const lead = partnerById.get(brief.partner_id)

  // Estimates in the buyer's currency: the region serving the page's country.
  const baseCurrency = String(brief.currency_code).toLowerCase()
  // Admins see our cost currency unless they ask for a country.
  const display =
    opts.audience === "admin" && !opts.country
      ? baseCurrency
      : (await regionCurrency(query, opts.country ?? brief.destination_country_code).catch(() => null)) ?? baseCurrency
  const fx: BriefFx = { base_currency: baseCurrency, display_currency: baseCurrency, rate: null, converted: false, reason: null }
  if (display !== baseCurrency) {
    try {
      const rate = await fetchExchangeRate(baseCurrency, display)
      const holder = { options: optionViews, currency_code: baseCurrency }
      convertBriefMoney(holder, rate, display)
      Object.assign(fx, { display_currency: display, rate, converted: true })
    } catch (e: any) {
      fx.reason = `No exchange rate for ${baseCurrency.toUpperCase()}→${display.toUpperCase()} right now; shown in ${baseCurrency.toUpperCase()}.`
    }
  }

  const base = {
    id: brief.id,
    title: brief.title,
    intro: brief.intro ?? null,
    status: brief.status,
    lead: { id: brief.partner_id, name: lead?.name?.trim() || null },
    recipient_name: brief.recipient_name ?? null,
    recipient_company: brief.recipient_company ?? null,
    destination_country_code: brief.destination_country_code,
    currency_code: fx.display_currency,
    fx,
    sample_quantity: brief.sample_quantity ?? null,
    sample_days: brief.sample_days ?? null,
    submitted_at: brief.submitted_at ?? null,
    expires_at: brief.expires_at ?? null,
    estimate_disclaimer: ESTIMATE_DISCLAIMER,
    options: optionViews,
    questions: questions.map((q: any) => ({
      id: q.id,
      key: q.key,
      label: q.label,
      help: q.help ?? null,
      kind: q.kind,
      options: Array.isArray(q.options) ? q.options : null,
      required: !!q.required,
      answer: q.answer ?? null,
    })),
    updates: [...(brief.updates ?? [])]
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .map((u: any) => ({
        id: u.id,
        kind: u.kind,
        message: u.message,
        media_urls: Array.isArray(u.media_urls) ? u.media_urls : [],
        created_at: u.created_at,
      })),
  }

  if (opts.audience === "buyer") return base
  return {
    ...base,
    partner_id: brief.partner_id,
    store_id: brief.store_id,
    customer_id: brief.customer_id ?? null,
    buyer_email: brief.buyer_email ?? null,
    opened_at: brief.opened_at ?? null,
    view_count: brief.view_count ?? 0,
    last_viewed_at: brief.last_viewed_at ?? null,
    quote_id: brief.quote_id ?? null,
    crm_person_id: brief.crm_person_id ?? null,
    crm_opportunity_id: brief.crm_opportunity_id ?? null,
    has_link: !!brief.token_hash,
  }
}

const byPosition = (a: any, b: any) => (a.position ?? 0) - (b.position ?? 0)

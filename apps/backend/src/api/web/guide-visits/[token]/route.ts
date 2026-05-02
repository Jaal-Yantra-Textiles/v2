import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { FORMS_MODULE } from "../../../../modules/forms"
import FormsService from "../../../../modules/forms/service"

/**
 * GET /web/guide-visits/:token
 *
 * Token-only auth. The guide's `access_token` lives on each guide entry
 * in Form.settings.guides[]. This route walks every tour form, finds
 * the ones where any guide carries the matching token, and returns the
 * upcoming + recent FormResponses across those forms — flattened so the
 * guide can see "everyone coming this week" in one list.
 *
 * Past visits older than 7 days are excluded so the list stays short.
 */

type GuideVisit = {
  response_id: string
  booking_ref: string | null
  tour_form: { id: string; title: string; handle: string }
  tour_date: string | null
  status: string
  traveller: Record<string, any> | null
  headcount: Record<string, number>
  selected_segments: Array<{ id: string; title: string; required: boolean }>
  answers: Record<string, any>
  payment: {
    paid_via_source: { provider: string; amount: number; currency: string } | null
    add_ons_due: number
    add_ons_currency: string
  } | null
}

const PAST_WINDOW_DAYS = 7

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const token = req.params.token
  if (!token || token.length < 16) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Invalid guide token")
  }

  const forms: FormsService = req.scope.resolve(FORMS_MODULE)

  // Walk all tour forms; in a real prod scenario we'd add a denormalised
  // index, but this list is small and walking is fine for now.
  const [tourForms] = await (forms as any).listAndCountForms(
    { type: "tour" },
    { take: 1000 }
  )

  const guideMatches: Array<{ form: any; guide: any }> = []
  for (const form of tourForms || []) {
    const settings = (form.settings as Record<string, any> | null) || {}
    const guides = Array.isArray(settings.guides) ? settings.guides : []
    const guide = guides.find(
      (g: any) => typeof g?.access_token === "string" && g.access_token === token
    )
    if (guide) guideMatches.push({ form, guide })
  }

  if (guideMatches.length === 0) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Guide not found")
  }

  // Profile of the guide (just the first matching form's record — guides are
  // keyed by token so any match has the same name/role).
  const guideProfile = (() => {
    const g = guideMatches[0].guide
    return {
      id: g.id || null,
      name: g.name || null,
      role: g.role || null,
      photo_url: g.photo_url || null,
    }
  })()

  const cutoff = new Date(Date.now() - PAST_WINDOW_DAYS * 86_400_000)

  const visits: GuideVisit[] = []
  for (const { form } of guideMatches) {
    const segments = Array.isArray((form.settings as any)?.itinerary_segments)
      ? ((form.settings as any).itinerary_segments as any[])
      : []
    const segmentIndex = new Map(segments.map((s) => [s.id, s]))

    const [responses] = await (forms as any).listAndCountFormResponses(
      { form_id: form.id },
      { take: 1000 }
    )

    for (const r of responses || []) {
      const data = (r.data as Record<string, any>) || {}
      const meta = (r.metadata as Record<string, any>) || {}
      const tourDate: string | null = meta?.gyg?.tour_date || null

      // Cull old visits.
      if (tourDate) {
        const d = new Date(tourDate)
        if (!isNaN(d.getTime()) && d < cutoff) continue
      }

      const selectedIds: string[] = Array.isArray(data.selected_segments)
        ? data.selected_segments.filter((s: any) => typeof s === "string")
        : []

      const includedSegments = segments
        .filter((s) => selectedIds.includes(s.id) || s.required)
        .map((s) => ({
          id: s.id,
          title: (s.title as string) || s.id,
          required: !!s.required,
        }))

      // Re-derive payment summary from selections so the guide sees what
      // the customer last saved (without forcing them to dig into JSON).
      const computeSubtotal = () => {
        const ids = new Set(selectedIds)
        let subtotal = 0
        let currency = "EUR"
        for (const s of segments) {
          if (!ids.has(s.id) && !s.required) continue
          const price = typeof s.base_price === "number" ? s.base_price : 0
          subtotal += price
          if (s.currency) currency = s.currency
        }
        return { subtotal, currency }
      }
      const cost = computeSubtotal()
      const gygPrice = meta?.gyg?.price as string | undefined
      const m = typeof gygPrice === "string" ? gygPrice.trim().match(/^([\d,]+(?:\.\d+)?)\s*([A-Z]{3})$/) : null
      const paid_via_source = m
        ? {
            provider: meta?.gyg?.booking_ref ? "GYG" : "Source",
            amount: parseFloat(m[1].replace(/,/g, "")),
            currency: m[2],
          }
        : null

      visits.push({
        response_id: r.id,
        booking_ref: meta?.gyg?.booking_ref || null,
        tour_form: { id: form.id, title: form.title, handle: form.handle },
        tour_date: tourDate,
        status: r.status,
        traveller: meta?.gyg?.traveller || null,
        headcount: (meta?.gyg?.headcount as Record<string, number>) || {},
        selected_segments: includedSegments,
        answers:
          typeof data.answers === "object" && data.answers ? data.answers : {},
        payment: {
          paid_via_source,
          add_ons_due: cost.subtotal,
          add_ons_currency: cost.currency,
        },
      })
    }
  }

  // Earliest tour first; null tour_date sinks to the bottom.
  visits.sort((a, b) => {
    if (!a.tour_date && !b.tour_date) return 0
    if (!a.tour_date) return 1
    if (!b.tour_date) return -1
    return new Date(a.tour_date).getTime() - new Date(b.tour_date).getTime()
  })

  res.status(200).json({
    guide: guideProfile,
    visits,
    upcoming_count: visits.filter((v) => {
      if (!v.tour_date) return false
      return new Date(v.tour_date).getTime() > Date.now()
    }).length,
  })
}

import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { FORMS_MODULE } from "../../../../modules/forms"
import FormsService from "../../../../modules/forms/service"
import { sendNotificationEmailWorkflow } from "../../../../workflows/email"
import { buildPaymentSummary, computeCost, getSegments } from "./helpers"

/**
 * GET /web/tour-visits/:token
 * PATCH /web/tour-visits/:token
 *
 * Token-only auth. The token is `verification_code` on `form_response`.
 * GET returns the tour form, current itinerary draft, and computed cost.
 * PATCH saves a new itinerary selection and returns the recomputed cost.
 */

const findResponseByToken = async (
  scope: MedusaRequest["scope"],
  token: string
): Promise<{ response: any; form: any; access_mode: "owner" | "share" }> => {
  if (!token || typeof token !== "string" || token.length < 16) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Invalid visit token")
  }

  const forms: FormsService = scope.resolve(FORMS_MODULE)

  // First try the canonical owner token.
  const responses = await forms.listFormResponses(
    { verification_code: token },
    { take: 1 }
  )
  let response = responses?.[0]
  let access_mode: "owner" | "share" = "owner"

  if (!response) {
    // Fall back to checking metadata.shares[].token across responses. This is
    // a small linear scan; for prod scale we'd add a dedicated table or a
    // metadata jsonb index. Fine for current volumes.
    const [allResponses] = await (forms as any).listAndCountFormResponses(
      {},
      { take: 1000 }
    )
    response = (allResponses || []).find((r: any) => {
      const shares = (r.metadata as any)?.shares
      return Array.isArray(shares) && shares.some((s: any) => s?.token === token)
    })
    if (response) access_mode = "share"
  }

  if (!response) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Visit not found")
  }

  if (
    response.verification_expires_at &&
    new Date(response.verification_expires_at).getTime() < Date.now()
  ) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Visit token expired")
  }

  // query.graph treats `fields` as both a projection key and a relation
  // name — when both collide the relation comes back empty. Resolve the
  // service directly so we can use `relations: ['fields']` reliably.
  const form = await (forms as any).retrieveForm(response.form_id, {
    relations: ["fields"],
  }).catch(() => null)

  if (!form) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Tour form no longer exists"
    )
  }
  if (form.type !== "tour") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Linked form is not a tour"
    )
  }

  return { response, form, access_mode }
}

const buildPayload = (
  response: any,
  form: any,
  access_mode: "owner" | "share" = "owner"
) => {
  const data = (response.data as Record<string, any>) || {}
  const selected: string[] = Array.isArray(data.selected_segments)
    ? data.selected_segments.filter((s: any) => typeof s === "string")
    : []
  const answers: Record<string, any> =
    typeof data.answers === "object" && data.answers ? data.answers : {}

  const headcount =
    (response.metadata as any)?.gyg?.headcount || ({} as Record<string, number>)

  const computed = computeCost(form, selected, headcount)
  const payment = buildPaymentSummary(response.metadata as any, computed)

  const sourceMetadata = (response.metadata as any)?.source
  const source =
    typeof sourceMetadata === "string"
      ? sourceMetadata
      : (response.metadata as any)?.gyg?.booking_ref
        ? "gyg"
        : null

  // Strip nothing from form — fields and settings are public on a published tour.
  return {
    form: {
      id: form.id,
      handle: form.handle,
      title: form.title,
      description: form.description,
      submit_label: form.submit_label,
      success_message: form.success_message,
      settings: form.settings,
      fields: form.fields || [],
      itinerary_segments: getSegments(form),
    },
    response: {
      id: response.id,
      status: response.status,
      submitted_at: response.submitted_at,
      updated_at: response.updated_at ?? response.submitted_at,
      answers,
      selected_segments: selected,
    },
    traveller: (response.metadata as any)?.gyg?.traveller || null,
    headcount,
    source,
    booking: {
      booking_ref: (response.metadata as any)?.gyg?.booking_ref || null,
      product: (response.metadata as any)?.gyg?.product || null,
      option: (response.metadata as any)?.gyg?.option || null,
      tour_date: (response.metadata as any)?.gyg?.tour_date || null,
      original_price: (response.metadata as any)?.gyg?.price || null,
    },
    cost: computed,
    payment,
    access_mode,
    // Owner sees the list of share tokens they've minted (so the wizard can
    // render Revoke buttons). Share-mode viewers see an empty list.
    shares:
      access_mode === "owner" && Array.isArray((response.metadata as any)?.shares)
        ? ((response.metadata as any).shares as Array<{
            token: string
            mode: string
            created_at: string
          }>).map((s) => ({
            token: s.token,
            mode: s.mode,
            created_at: s.created_at,
          }))
        : [],
  }
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const token = req.params.token
  const { response, form, access_mode } = await findResponseByToken(req.scope, token)
  res.status(200).json(buildPayload(response, form, access_mode))
}

/**
 * Build the customer-facing visit URL server-side. Defaults to the
 * production website host so a misconfigured deploy still mails out a
 * working link instead of a localhost one.
 */
const buildVisitUrl = (token: string): string => {
  const base = (
    process.env.PUBLIC_TOUR_VISIT_BASE_URL || "https://jaalyantra.com"
  ).replace(/\/$/, "")
  return `${base}/tours/visit/${token}`
}

export const PATCH = async (
  req: MedusaRequest<{
    selected_segments?: string[]
    answers?: Record<string, any>
    confirm?: boolean
  }>,
  res: MedusaResponse
) => {
  const token = req.params.token
  const { response, form, access_mode } = await findResponseByToken(req.scope, token)

  if (access_mode === "share") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "This is a read-only share link. Ask the original recipient to make changes."
    )
  }

  const body = req.validatedBody || (req.body as any) || {}
  const incomingSelected: string[] = Array.isArray(body.selected_segments)
    ? body.selected_segments.filter((s: any) => typeof s === "string")
    : []
  const incomingAnswers: Record<string, any> =
    body.answers && typeof body.answers === "object" ? body.answers : {}

  // Reject unknown segment ids — keep saved data clean.
  const validIds = new Set(getSegments(form).map((s) => s.id))
  const cleanedSelected = incomingSelected.filter((id) => validIds.has(id))

  const forms: FormsService = req.scope.resolve(FORMS_MODULE)

  const nextStatus =
    response.status === "pending_verification" ? "new" : response.status

  const updated = await forms.updateFormResponses({
    id: response.id,
    status: nextStatus as any,
    data: {
      selected_segments: cleanedSelected,
      answers: incomingAnswers,
    },
  })

  const next = Array.isArray(updated) ? updated[0] : updated

  // Final-confirm path: send the customer their itinerary recap on the
  // first confirm only. Subsequent PATCHes with confirm:true (e.g. from a
  // double-click or a returning visitor re-clicking Confirm) skip the
  // email but still update the response. metadata.confirmed_at acts as
  // the idempotency marker.
  const previouslyConfirmedAt =
    typeof (next.metadata as any)?.confirmed_at === "string"
      ? (next.metadata as any).confirmed_at
      : null

  if (body.confirm && next.email && !previouslyConfirmedAt) {
    try {
      const segs = getSegments(form)
      const selectedSet = new Set(cleanedSelected)
      const includedSegments = segs
        .filter((s) => selectedSet.has(s.id) || s.required)
        .map((s) => ({
          title: s.title || s.id,
          duration:
            typeof s.duration_minutes === "number" && s.duration_minutes > 0
              ? `${s.duration_minutes} min`
              : null,
          required: !!s.required,
        }))

      const headcount =
        ((next.metadata as any)?.gyg?.headcount as Record<string, number>) || {}
      const computed = computeCost(form, cleanedSelected, headcount)
      const payment = buildPaymentSummary(next.metadata as any, computed)
      const traveller = (next.metadata as any)?.gyg?.traveller || {}

      await sendNotificationEmailWorkflow(req.scope).run({
        input: {
          to: next.email,
          template: "tour-itinerary-confirmation",
          data: {
            first_name: traveller.first_name || "there",
            tour_title:
              (next.metadata as any)?.gyg?.product || form.title || "Your visit",
            tour_date: (next.metadata as any)?.gyg?.tour_date || null,
            // Visit URL is constructed server-side from
            // PUBLIC_TOUR_VISIT_BASE_URL — never trust the client.
            visit_url: buildVisitUrl(token),
            segments: includedSegments,
            has_payment: !!payment.paid_via_source || payment.add_ons_due > 0,
            paid_provider: payment.paid_via_source?.provider || "",
            paid_amount: payment.paid_via_source?.amount || 0,
            paid_currency: payment.paid_via_source?.currency || "",
            add_ons_amount: payment.add_ons_due,
            add_ons_currency: payment.add_ons_currency,
          },
        },
      })

      // Mark idempotency. Subsequent confirms by the same customer no
      // longer trigger a duplicate email but their save still persists.
      await (forms as any).updateFormResponses({
        id: next.id,
        metadata: {
          ...((next.metadata as any) || {}),
          confirmed_at: new Date().toISOString(),
        },
      })
    } catch (err) {
      // Log only — confirmation UX shouldn't fail because email is misbehaving.
      // The customer already saw the in-app confirmation. Note: we do NOT
      // set confirmed_at here, so the next click will retry the email.
      console.error("tour-itinerary-confirmation email failed", err)
    }
  }

  res.status(200).json(buildPayload(next, form, access_mode))
}

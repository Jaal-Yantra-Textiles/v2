import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import { FORMS_MODULE } from "../../../../modules/forms"
import FormsService from "../../../../modules/forms/service"
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
): Promise<{ response: any; form: any }> => {
  if (!token || typeof token !== "string" || token.length < 16) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Invalid visit token")
  }

  const forms: FormsService = scope.resolve(FORMS_MODULE)

  const responses = await forms.listFormResponses(
    { verification_code: token },
    { take: 1 }
  )
  const response = responses?.[0]
  if (!response) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Visit not found")
  }

  if (
    response.verification_expires_at &&
    new Date(response.verification_expires_at).getTime() < Date.now()
  ) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Visit token expired")
  }

  const query: any = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: forms_data } = await query.graph({
    entity: "form",
    filters: { id: response.form_id },
    fields: ["*", "fields.*"],
    pagination: { take: 1 },
  })
  const form = forms_data?.[0]
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

  return { response, form }
}

const buildPayload = (response: any, form: any) => {
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
  }
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const token = req.params.token
  const { response, form } = await findResponseByToken(req.scope, token)
  res.status(200).json(buildPayload(response, form))
}

export const PATCH = async (
  req: MedusaRequest<{
    selected_segments?: string[]
    answers?: Record<string, any>
  }>,
  res: MedusaResponse
) => {
  const token = req.params.token
  const { response, form } = await findResponseByToken(req.scope, token)

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
  res.status(200).json(buildPayload(next, form))
}

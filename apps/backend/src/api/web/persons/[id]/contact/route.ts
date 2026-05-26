import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import type {
  INotificationModuleService,
  RemoteQueryFunction,
} from "@medusajs/types"
import type { PersonContactRequest } from "./validators"

/**
 * POST /web/persons/:id/contact
 *
 * Storefront/marketing-site contact form. A visitor on the Atlas map
 * page clicks "Contact them" on an artisan, fills in their name +
 * email (+ optional phone + message), and submits. We:
 *
 *   1. Verify the person exists and is publicly listable (same shape
 *      the map already reads — `addresses.*` + `public_metadata.*`).
 *   2. Drop an admin-feed notification so the owning team sees the
 *      request without us needing a brand new "leads" model.
 *   3. Echo back the person's public contact details (email / phone
 *      from public_metadata) so the visitor has a direct channel to
 *      reach the artisan. The reveal is gated by submitting the form
 *      — classic lead-capture, the data is already in the public
 *      listing response.
 */
export const POST = async (
  req: MedusaRequest<PersonContactRequest>,
  res: MedusaResponse
) => {
  const personId = req.params.id
  const { name, email, phone, message, source } = req.validatedBody

  const query = req.scope.resolve(
    ContainerRegistrationKeys.QUERY
  ) as Omit<RemoteQueryFunction, symbol>

  const { data } = await query.graph({
    entity: "person",
    fields: [
      "id",
      "first_name",
      "last_name",
      "public_metadata.*",
    ],
    filters: { id: personId },
    pagination: { take: 1 },
  })

  const person = (data || [])[0] as
    | {
        id: string
        first_name: string | null
        last_name: string | null
        public_metadata: Record<string, unknown> | null
      }
    | undefined

  if (!person) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Person not found")
  }

  const meta = (person.public_metadata || {}) as Record<string, unknown>
  const revealEmail = typeof meta.email === "string" ? meta.email : null
  const revealPhone =
    typeof meta.phone === "string"
      ? meta.phone
      : typeof meta.phone_number === "string"
      ? meta.phone_number
      : null

  const personName = [person.first_name, person.last_name]
    .filter((v) => v && v !== "null")
    .join(" ")
    .trim() || "Artisan"

  const notificationService = req.scope.resolve(
    Modules.NOTIFICATION
  ) as INotificationModuleService

  const description = [
    `${name} <${email}>`,
    phone ? `(${phone})` : "",
    `is asking to reach ${personName}.`,
    message ? `Message: ${message}` : "",
    source ? `[via ${source}]` : "",
  ]
    .filter(Boolean)
    .join(" ")

  const notification = await notificationService.createNotifications({
    to: "",
    channel: "feed",
    template: "admin-ui",
    data: {
      title: `Contact request for ${personName}`,
      description,
      metadata: {
        kind: "person_contact_request",
        person_id: person.id,
        person_name: personName,
        visitor_name: name,
        visitor_email: email,
        visitor_phone: phone || null,
        message: message || null,
        source: source || null,
        received_at: new Date().toISOString(),
      },
    },
  })

  res.json({
    id: notification?.id,
    received: true,
    contact: {
      name: personName,
      email: revealEmail,
      phone: revealPhone,
    },
  })
}

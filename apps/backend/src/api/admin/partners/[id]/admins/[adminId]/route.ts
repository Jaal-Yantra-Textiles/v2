import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { PARTNER_MODULE } from "../../../../../../modules/partner"
import PartnerService from "../../../../../../modules/partner/service"

type UpdatePartnerAdminPayload = {
  first_name?: string | null
  last_name?: string | null
  phone?: string | null
  role?: "owner" | "admin" | "manager"
  preferred_language?: string | null
  is_active?: boolean
}

const ALLOWED_FIELDS: (keyof UpdatePartnerAdminPayload)[] = [
  "first_name",
  "last_name",
  "phone",
  "role",
  "preferred_language",
  "is_active",
]

/**
 * PATCH /admin/partners/:id/admins/:adminId
 * Update a partner admin's profile fields (including preferred_language).
 */
export const PATCH = async (
  req: AuthenticatedMedusaRequest<UpdatePartnerAdminPayload>,
  res: MedusaResponse
) => {
  const { id: partnerId, adminId } = req.params

  // Ensure the admin belongs to the given partner before updating.
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "partners",
    fields: ["id", "admins.id"],
    filters: { id: partnerId },
  })
  const partner = (data || [])[0] as any
  if (!partner) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Partner not found")
  }
  const admins = Array.isArray(partner.admins) ? partner.admins : []
  if (!admins.some((a: any) => a?.id === adminId)) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Admin not found for this partner"
    )
  }

  const body = (req.validatedBody || req.body || {}) as UpdatePartnerAdminPayload
  const update: Record<string, any> = {}
  for (const key of ALLOWED_FIELDS) {
    if (key in body) update[key] = body[key]
  }

  if (Object.keys(update).length === 0) {
    const { data: refetch } = await query.graph({
      entity: "partner_admin",
      fields: [
        "id",
        "first_name",
        "last_name",
        "email",
        "phone",
        "role",
        "is_active",
        "preferred_language",
      ],
      filters: { id: adminId },
    })
    res.json({ admin: (refetch || [])[0] })
    return
  }

  const partnerService: PartnerService = req.scope.resolve(PARTNER_MODULE)
  const updated = await partnerService.updatePartnerAdmins({
    id: adminId,
    ...update,
  } as any)

  const admin = Array.isArray(updated) ? updated[0] : updated
  res.json({ admin })
}

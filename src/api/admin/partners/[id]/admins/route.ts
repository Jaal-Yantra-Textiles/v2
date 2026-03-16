import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import addPartnerAdminWorkflow from "../../../../../workflows/partners/add-partner-admin"

/**
 * POST /admin/partners/:id/admins
 * Add a new admin to an existing partner. Registers auth credentials and sends welcome email.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { id: partnerId } = req.params
  const body = req.body as {
    email: string
    first_name?: string
    last_name?: string
    phone?: string
    role?: "owner" | "admin" | "manager"
    password?: string
  }

  if (!body.email) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Email is required"
    )
  }

  const { result } = await addPartnerAdminWorkflow(req.scope).run({
    input: {
      partner_id: partnerId,
      admin: {
        email: body.email,
        first_name: body.first_name,
        last_name: body.last_name,
        phone: body.phone,
        role: body.role || "admin",
      },
      password: body.password,
    },
  })

  res.status(201).json({
    admin: result.admin,
    temp_password: result.tempPassword,
  })
}

/**
 * GET /admin/partners/:id/admins
 * List admins for a partner.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { id: partnerId } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data } = await query.graph({
    entity: "partners",
    fields: [
      "admins.id",
      "admins.first_name",
      "admins.last_name",
      "admins.email",
      "admins.phone",
      "admins.role",
      "admins.is_active",
      "admins.created_at",
    ],
    filters: { id: partnerId },
  })

  const admins = (data?.[0] as any)?.admins || []

  res.json({ admins, count: admins.length })
}

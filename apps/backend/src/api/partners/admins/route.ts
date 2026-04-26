import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../helpers"
import addPartnerAdminWorkflow from "../../../workflows/partners/add-partner-admin"

/**
 * GET /partners/admins
 * List admins for the current partner.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner associated with this account"
    )
  }

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
    filters: { id: partner.id },
  })

  const admins = (data?.[0] as any)?.admins || []
  res.json({ admins, count: admins.length })
}

/**
 * POST /partners/admins
 * Add a new admin to the current partner. Registers auth and sends welcome email.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner associated with this account"
    )
  }

  const body = req.body as {
    email: string
    first_name?: string
    last_name?: string
    phone?: string
    role?: "owner" | "admin" | "manager"
    password?: string
  }

  if (!body.email) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Email is required")
  }

  const { result } = await addPartnerAdminWorkflow(req.scope).run({
    input: {
      partner_id: partner.id,
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

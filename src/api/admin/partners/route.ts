import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { listPartnersWorkflow } from "../../../workflows/partners/list-partners"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { createPartnerAdminWithRegistrationWorkflow } from "../../../workflows/partner/create-partner-admin"
import { PostPartnerWithAdminSchema } from "./validators"

export const GET = async (
  req: MedusaRequest & {
    query?: {
      offset?: number
      limit?: number
      name?: string
      handle?: string
      status?: "active" | "inactive" | "pending"
      is_verified?: boolean
    }
  },
  res: MedusaResponse
) => {
  const offset = Number(req.query?.offset ?? 0)
  const limit = Number(req.query?.limit ?? 20)

  const { result } = await listPartnersWorkflow(req.scope).run({
    input: {
      fields: req.queryConfig?.fields || ["*"],
      filters: {
        name: req.query?.name,
        handle: req.query?.handle,
        status: req.query?.status,
        is_verified: req.query?.is_verified,
      },
      offset,
      limit,
    },
  })

  const partners = (result as any)?.data || []
  const metadata = (result as any)?.metadata || {}

  res.status(200).json({
    partners,
    count: metadata?.count ?? partners.length,
    offset,
    limit,
  })
}

// POST /admin/partners - create partner with primary admin
export const POST = async (
  req: MedusaRequest<PostPartnerWithAdminSchema>,
  res: MedusaResponse
) => {
  const { partner: partnerInput, admin: adminInput } = req.validatedBody

  // Use internal workflow that registers auth identity and links it
  const { result, errors } = await createPartnerAdminWithRegistrationWorkflow(req.scope).run({
    input: {
      partner: partnerInput,
      admin: adminInput,
    },
  })

  if (errors?.length) {
    throw (
      errors[0].error ||
      new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Failed to create partner admin"
      )
    )
  }

  const payload = result as any

  // Emit partner.created.fromAdmin with the workflow-provided temp password
  const eventService = req.scope.resolve(Modules.EVENT_BUS)
  console.log("Emitting partner.created.fromAdmin event",payload)
  eventService.emit({
    name: "partner.created.fromAdmin",
    data: {
      partner_id: payload.partnerWithAdmin.createdPartner.id,
      partner_admin_id: payload.partnerWithAdmin.partnerAdmin.id,
      email: adminInput.email,
      temp_password: payload.registered.tempPassword,
    },
  })

  return res.status(201).json({
    partner: payload.partnerWithAdmin.createdPartner,
    partner_admin: payload.partnerWithAdmin.partnerAdmin,
  })
}

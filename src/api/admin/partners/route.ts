import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { listPartnersWorkflow } from "../../../workflows/partners/list-partners"
import { z } from "zod"
import createPartnerAdminWorkflow from "../../../workflows/partner/create-partner-admin"
import { MedusaError } from "@medusajs/framework/utils"
import { PARTNER_MODULE } from "../../../modules/partner"
import PartnerService from "../../../modules/partner/service"
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
 
   const { partner: partnerInput, admin: adminInput, auth_identity_id } = req.validatedBody
   console.log(partnerInput, adminInput, auth_identity_id)

  // If auth identity is provided, run the full workflow (creates partner, admin, and sets app metadata)
  if (auth_identity_id) {
    const { result, errors } = await createPartnerAdminWorkflow(req.scope).run({
      input: {
        partner: partnerInput,
        admin: adminInput,
        authIdentityId: auth_identity_id,
      },
    })

    if (errors?.length) {
      throw errors[0].error || new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Failed to create partner admin")
    }

    const payload = result as any
    return res.status(201).json({
      partner: payload.createdPartner,
      partner_admin: payload.partnerAdmin,
    })
  }

  // Fallback path: create partner and admin without linking auth identity
  const partnerService: PartnerService = req.scope.resolve(PARTNER_MODULE)
  try {
    const createdPartner = await partnerService.createPartners(partnerInput)
    const partnerAdmin = await partnerService.createPartnerAdmins({
      ...adminInput,
      partner_id: createdPartner.id,
    })

    return res.status(201).json({
      partner: createdPartner,
      partner_admin: partnerAdmin,
    })
  } catch (err: any) {
    if (typeof err?.message === "string" && err.message.includes("already exists")) {
      throw new MedusaError(
        MedusaError.Types.DUPLICATE_ERROR,
        `A partner with handle "${partnerInput.handle}" already exists. Please use a unique handle.`
      )
    }
    throw err
  }
}

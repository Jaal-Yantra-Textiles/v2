import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { PLATFORM_TAX_IDENTITY_MODULE } from "../../../../../modules/platform-tax-identity"
import { gstinStateCode, stateCodeOf, stateName } from "../../../../../lib/invoices/gst-state"
import type { SetRegisteredAddressBody } from "../../validators"

/**
 * POST /admin/platform-tax-identities/:id/registered-address
 *
 * Set the registered address a GST tax invoice prints as the seller (#2532).
 * Refuses an address whose state is not the GSTIN's own state: a registration
 * is for one state, and a Delhi GSTIN printed over a Himachal address is the
 * exact mismatch this field exists to stop.
 */
export const POST = async (
  req: MedusaRequest<SetRegisteredAddressBody>,
  res: MedusaResponse
) => {
  const body = req.validatedBody as SetRegisteredAddressBody
  const service: any = req.scope.resolve(PLATFORM_TAX_IDENTITY_MODULE)

  const [identity] = await service.listPlatformTaxIdentities({ id: req.params.id })
  if (!identity) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Tax identity ${req.params.id} not found`)
  }

  const gstinCode = identity.tax_id_type === "gstin" ? gstinStateCode(identity.tax_id) : null
  const addressCode = stateCodeOf(body.province)
  if (gstinCode && addressCode !== gstinCode) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `${identity.tax_id} is registered in ${stateName(gstinCode)} (${gstinCode}), but the address is in "${body.province}". Use the registered address from the GST certificate.`
    )
  }

  const updated = await service.updatePlatformTaxIdentities({
    id: identity.id,
    registered_address: { ...body, country_code: "in" },
  })
  res.json({ platform_tax_identity: updated })
}

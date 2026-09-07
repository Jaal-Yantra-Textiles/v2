import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import type { RemoteQueryFunction } from "@medusajs/types"

/**
 * 404 for an unknown partner, thrown from inside the workflow so every caller
 * inherits it.
 *
 * An admin naming a partner that does not exist is a typo. Without this check
 * a write creates a row nobody can reach and a read answers an empty result
 * that reads as "this partner has nothing" — both worse than a clean 404,
 * which is what the sibling admin partner routes throw.
 */
export const assertPartnerExistsStep = createStep(
  "assert-partner-exists-step",
  async (input: { partner_id: string }, { container }) => {
    const query = container.resolve(
      ContainerRegistrationKeys.QUERY
    ) as Omit<RemoteQueryFunction, symbol>

    const { data } = await query.graph({
      entity: "partner",
      fields: ["id", "name"],
      filters: { id: input.partner_id },
    })

    if (!data?.length) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "Partner not found")
    }

    return new StepResponse(data[0])
  }
)

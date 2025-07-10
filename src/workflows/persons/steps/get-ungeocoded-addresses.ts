import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/utils"
import { type PersonAddress } from "../../../modules/person/models/person_address"

const getUngeocodedAddressesStepId = "get-ungeocoded-addresses-step"

export const getUngeocodedAddressesStep = createStep(
  getUngeocodedAddressesStepId,
  async (input: { person_id: string }, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    const result = await query.graph({
      entity: "person_address",
      fields: ["id", "latitude", "longitude", "postal_code", "country"],
      filters: {
        person_id: input.person_id,
        $or: [{ latitude: null }, { longitude: null }],
      },
    })
    const addresses = result.data
    return new StepResponse(addresses)
  }
)

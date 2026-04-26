import { createStep, StepResponse } from "@medusajs/workflows-sdk"
import PersonService from "../../../modules/person/service"
import { PersonAddress } from "../../../modules/person/models/person_address"
import { InferTypeOf } from "@medusajs/framework/types"
import { PERSON_MODULE } from "../../../modules/person"

export const getAllUngeocodedAddressesStep = createStep(
  "get-all-ungeocoded-addresses-step",
  async (_, { container }) => {
    const personService = container.resolve<PersonService>(PERSON_MODULE)

    const [addresses] = await personService.listAndCountAddresses({
      latitude: null,
      longitude: null,
    }, {
      select: ["id"],
    })

    return new StepResponse(addresses)
  }
)

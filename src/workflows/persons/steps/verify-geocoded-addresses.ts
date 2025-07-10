import PersonService from "../../../modules/person/service";
import { PersonAddress } from "../../../modules/person/models/person_address";
import { createStep, StepResponse } from "@medusajs/workflows-sdk";
import { PERSON_MODULE } from "../../../modules/person";

interface StepInput {
  addresses: any[];
}

export const verifyGeocodedAddressesStepId = "verify-geocoded-addresses";

export const verifyGeocodedAddressesStep = createStep(
  verifyGeocodedAddressesStepId,
  async (input: StepInput, { container }) => {
    const personService: PersonService = container.resolve(PERSON_MODULE);
    const addressIds = input.addresses.map((a) => a.id);

    const addresses = await personService.listAddresses({ id: addressIds });

    const ungeocoded = addresses.filter(
      (a) => a.latitude === null || a.longitude === null
    );

    if (ungeocoded.length > 0) {
      throw new Error(
        `Verification failed. ${ungeocoded.length} addresses still missing geocodes.`
      );
    }

    return new StepResponse({ verified: true, count: addresses.length });
  },
  async (output, { container }) => {
    // No compensation needed for a verification step
  }
);

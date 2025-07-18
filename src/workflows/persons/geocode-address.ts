import { createWorkflow, createStep, StepResponse, transform, WorkflowResponse } from "@medusajs/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/utils"
import { PERSON_MODULE } from "../../modules/person";
import { InferTypeOf } from "@medusajs/framework/types";
import PersonAddress  from "../../modules/person/models/person_address"
import PersonService from "../../modules/person/service";
export type PersonAddress = InferTypeOf<typeof PersonAddress>

interface GeocodeAddressWorkflowInput {
  person_address_id: string;
}

interface AddressStepOutput {
  address: {
    postal_code: string;
    country: string;
  }
}

const getAddressStep = createStep(
  "get-address-step",
  async (input: GeocodeAddressWorkflowInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const result = await query.graph({
      entity: "person_address",
      fields: ["id", "postal_code", "country", "latitude", "longitude"],
      filters: { id: input.person_address_id }
    })

    const addresses = result.data
   
    if (!addresses || addresses.length === 0) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Person address with id ${input.person_address_id} not found`)
    }
    if (addresses[0].latitude || addresses[0].longitude) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `Person address with id ${input.person_address_id} already has geocoded data`)
    }
    return new StepResponse({ address: addresses[0]})
  }
)

interface GeocodeStepOutput {
  lat: number | null;
  lon: number | null;
}

const geocodeAddressStep = createStep(
  "geocode-address-step",
  async ({ address }: AddressStepOutput, { container }): Promise<StepResponse<GeocodeStepOutput>> => {
   
    if (!address.postal_code || !address.country) {
      return new StepResponse({ lat: null, lon: null })
    }
    const query = `${address.postal_code}, ${address.country}`;
    try {
            const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`, {
        headers: {
          'User-Agent': 'Jaal-Yantra-Textiles-App/1.0'
        }
      });
      const data = await response.json();
      if (data && data.length > 0) {
        const { lat, lon } = data[0];
        return new StepResponse({ lat: parseFloat(lat), lon: parseFloat(lon) });
      }
    } catch (error) {
      console.error("Geocoding error:", error);
      return new StepResponse({ lat: null, lon: null });
    }
   
    return new StepResponse({ lat: null, lon: null });
  }
)

const updateAddressStep = createStep(
  "update-address-step",
  async (input: { address_id: string, lat: number | null, lon: number | null }, { container }) => {
    if (input.lat === null || input.lon === null) {
      return new StepResponse({ success: false });
    }
    const personService: PersonService = container.resolve(PERSON_MODULE)
    await personService.updateAddresses([{
      id: input.address_id,
      latitude: input.lat,
      longitude: input.lon
    }])
    console.log("Address updated successfully")
    return new StepResponse({ success: true });
  }
)

export const geocodeAddressWorkflow = createWorkflow(
  "geocode-address-workflow",
  (input: GeocodeAddressWorkflowInput) => {
    const { address } = getAddressStep(input)

    const geocodedData = geocodeAddressStep({ address })

    const updateInput = transform({ address, geocodedData }, (data) => {
      return {
        address_id: data.address.id,
        lat: data.geocodedData.lat,
        lon: data.geocodedData.lon,
      }
    })

    const result = updateAddressStep(updateInput)
    return new WorkflowResponse(result)
  }
)

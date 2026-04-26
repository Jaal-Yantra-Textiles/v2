
import { StepResponse } from "@medusajs/framework/workflows-sdk"
import createAddressWorkflow from "../persons/create-address"

createAddressWorkflow.hooks.personAddressCreated(
    async ({ personId }, { container }) => {
        // TODO perform an action
        // Perform a action to update the person with the new address and increment 
        // the onboarding state
        return new StepResponse()
    }
)

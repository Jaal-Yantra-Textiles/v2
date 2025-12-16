import { MedusaError, Modules } from "@medusajs/framework/utils"
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/workflows-sdk"
import type { IAuthModuleService } from "@medusajs/types"

// Step: list provider identities by email (entity_id is the email in Medusa v2)
// If error_if_exists is true and identities exist, throw NOT_ALLOWED
export const listAuthIdentitiesByEmailStep = createStep(
  "list-auth-identities-by-email-step",
  async (input: { email: string; error_if_exists?: boolean }, { container }) => {
    const authModule = container.resolve(Modules.AUTH) as IAuthModuleService
    const providerIdentities = await authModule.listProviderIdentities({ entity_id: input.email })

    if (input.error_if_exists && providerIdentities && providerIdentities.length > 0) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Auth identity already exists for this email"
      )
    }

    return new StepResponse(providerIdentities || [])
  }
)

// Workflow: just returns identities from the step
export const listUserAuthIdentitiesWorkflow = createWorkflow(
  "list-user-auth-identities",
  (input: { email: string; error_if_exists?: boolean }) => {
    const identities = listAuthIdentitiesByEmailStep({ email: input.email, error_if_exists: input.error_if_exists })
    return new WorkflowResponse(identities)
  }
)

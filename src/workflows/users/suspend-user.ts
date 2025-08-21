import { MedusaError, Modules } from "@medusajs/framework/utils";
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/workflows-sdk";
import { UserDTO } from "@medusajs/types";

export const listAuthIdentitiesStep = createStep(
    "list-auth-identities-step",
    async (user: UserDTO, { container }) => {
        const authModule = container.resolve(Modules.AUTH)
        
        // Query provider identities using user email (entity_id is the email in MedusaJS v2)
        const providerIdentities = await authModule.listProviderIdentities({
            entity_id: user.email
        })
        
        if (!providerIdentities || providerIdentities.length === 0) {
            throw new MedusaError(MedusaError.Types.NOT_FOUND, "No auth identities found for user")
        }
        
        const providerIdentity = providerIdentities[0]
        
        // Check if auth identity is already suspended
        if (providerIdentity.auth_identity_id) {
            const authIdentity = await authModule.retrieveAuthIdentity(
                providerIdentity.auth_identity_id
            )
            
            if (authIdentity.app_metadata?.suspended) {
                throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "User is already suspended")
            }
        }
        
        return new StepResponse(providerIdentity)
    },
)



export const listUserStep = createStep(
    "list-user-step",
    async (input: { userId: string }, { container }) => {
        const userModule = container.resolve(Modules.USER)
        const user: UserDTO = await userModule.retrieveUser(input.userId)
        
        // Check if user is already suspended in user metadata
        if (user.metadata?.suspended) {
            throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "User is already suspended")
        }
        
        return new StepResponse(user)
    },
)


export const updateUserMetaDataStep = createStep(
    "update-user-metadata-step",
    async (userId: string, { container }) => {
        const userModule = container.resolve(Modules.USER)
        
        // Update user metadata to mark as suspended
        const user = await userModule.updateUsers({
            id: userId,
            metadata: {
                suspended: true,
                suspended_at: new Date().toISOString()
            }
        })
        
        return new StepResponse(user, {
            userId,
            previousMetadata: user.metadata
        })
    },
    async (rollbackData, { container }) => {
        // Rollback: remove suspension from user metadata
        if (!rollbackData) return
        
        const userModule = container.resolve(Modules.USER)
        await userModule.updateUsers({
            id: rollbackData.userId,
            metadata: rollbackData.previousMetadata
        })
    }
)


export const suspendByDeletingProviderIdentityStep = createStep(
    "suspend-by-deleting-provider-identity-step",
    async (input: { providerIdentityId: string, userId: string }, { container }) => {
        const authModule = container.resolve(Modules.AUTH)
        
        // Get the provider identity to preserve its data
        const providerIdentity = await authModule.retrieveProviderIdentity(input.providerIdentityId)
        
        if (!providerIdentity.auth_identity_id) {
            throw new MedusaError(MedusaError.Types.INVALID_DATA, "Provider identity has no associated auth identity")
        }
        
        // Get current auth identity to preserve state
        const currentAuthIdentity = await authModule.retrieveAuthIdentity(providerIdentity.auth_identity_id)
        
        // Store suspension data in auth identity metadata before deleting provider identity
        await authModule.updateAuthIdentities([{
            id: providerIdentity.auth_identity_id,
            app_metadata: {
                ...currentAuthIdentity.app_metadata,
                suspended: true,
                suspended_at: new Date().toISOString(),
                suspended_by: "system",
                original_user_id: input.userId,
                // Store provider identity data for restoration
                suspended_provider_data: {
                    entity_id: providerIdentity.entity_id,
                    provider: providerIdentity.provider,
                    provider_metadata: providerIdentity.provider_metadata,
                    user_metadata: providerIdentity.user_metadata
                }
            }
        }])
        
        // Delete the provider identity to prevent authentication
        await authModule.deleteProviderIdentities([input.providerIdentityId])
        
        return new StepResponse({
            authIdentityId: providerIdentity.auth_identity_id,
            deletedProviderId: input.providerIdentityId
        }, {
            authIdentityId: providerIdentity.auth_identity_id,
            providerIdentityData: {
                id: providerIdentity.id,
                entity_id: providerIdentity.entity_id,
                provider: providerIdentity.provider,
                provider_metadata: providerIdentity.provider_metadata,
                user_metadata: providerIdentity.user_metadata,
                auth_identity_id: providerIdentity.auth_identity_id
            },
            previousAuthMetadata: currentAuthIdentity.app_metadata
        })
    },
    async (rollbackData, { container }) => {
        // Rollback: recreate the provider identity and restore auth metadata
        if (!rollbackData) return
        
        const authModule = container.resolve(Modules.AUTH)
        
        // Recreate the provider identity
        await authModule.createProviderIdentities([{
            entity_id: rollbackData.providerIdentityData.entity_id,
            provider: rollbackData.providerIdentityData.provider,
            provider_metadata: rollbackData.providerIdentityData.provider_metadata,
            user_metadata: rollbackData.providerIdentityData.user_metadata,
            auth_identity_id: rollbackData.providerIdentityData.auth_identity_id
        }])
        
        // Restore previous auth metadata
        await authModule.updateAuthIdentities([{
            id: rollbackData.authIdentityId,
            app_metadata: rollbackData.previousAuthMetadata
        }])
    }
)


export const suspendUserWorkflow = createWorkflow(
    "suspend-user-workflow",
    (input: { userId: string }) => {
        // Step 1: Validate and retrieve user
        const user = listUserStep(input);
        
        // Step 2: Get user's auth identities
        const providerIdentity = listAuthIdentitiesStep(user);
        
        // Step 3: Suspend by deleting provider identity (this truly prevents authentication)
        const suspensionResult = suspendByDeletingProviderIdentityStep({
            providerIdentityId: providerIdentity.id,
            userId: input.userId
        });
        
        // Step 4: Update user metadata for tracking
        const updatedUser = updateUserMetaDataStep(input.userId);

        // Return the results
        return new WorkflowResponse({
            user: updatedUser,
            suspension: suspensionResult
        });
    }
);

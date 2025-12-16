import { MedusaError, Modules } from "@medusajs/framework/utils";
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/workflows-sdk";
import type { IAuthModuleService, IUserModuleService, AuthIdentityDTO, UserDTO } from "@medusajs/types";

// Step 1: Find user and check if they are suspended
export const findUserToUnsuspendStep = createStep(
    "find-user-to-unsuspend-step",
    async (input: { userId: string }, { container }) => {
        const userModule = container.resolve(Modules.USER) as IUserModuleService;
        const user = await userModule.retrieveUser(input.userId);

        if (!user.metadata?.suspended) {
            throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "User is not suspended");
        }
        return new StepResponse(user);
    },
);

// Step 2: Find the suspended auth identity for the user
export const findSuspendedAuthIdentityStep = createStep(
    "find-suspended-auth-identity-step",
    async (user: UserDTO, { container }) => {
        const authModule = container.resolve(Modules.AUTH) as IAuthModuleService;
        
        // For suspended users, provider identities are deleted, so we need to find auth identities directly
        // Look for auth identities with suspended metadata containing the user's email
        const authIdentities = await authModule.listAuthIdentities();
        
        let suspendedAuthIdentity: AuthIdentityDTO | null = null;
        for (const authIdentity of authIdentities) {
            const suspendedData = authIdentity.app_metadata?.suspended_provider_data as any;
            if (authIdentity.app_metadata?.suspended && 
                suspendedData?.entity_id === user.email) {
                suspendedAuthIdentity = authIdentity;
                break;
            }
        }
        
        if (!suspendedAuthIdentity) {
            throw new MedusaError(MedusaError.Types.NOT_FOUND, "No suspended auth identity found for user");
        }
        
        if (!suspendedAuthIdentity.app_metadata?.original_user_id) {
            throw new MedusaError(MedusaError.Types.INVALID_DATA, "No original user ID found in suspended auth identity");
        }
        
        if (!suspendedAuthIdentity.app_metadata?.suspended_provider_data) {
            throw new MedusaError(MedusaError.Types.INVALID_DATA, "No suspended provider data found for restoration");
        }
        
        return new StepResponse(suspendedAuthIdentity);
    },
);

// Step 3: Recreate provider identity and clean up suspension metadata
export const recreateProviderIdentityStep = createStep(
    "recreate-provider-identity-step",
    async (authIdentity: AuthIdentityDTO, { container }) => {
        const authModule = container.resolve(Modules.AUTH) as IAuthModuleService;
        
        // Get the suspended provider data
        const suspendedProviderData = authIdentity.app_metadata?.suspended_provider_data as any;
        const originalUserId = authIdentity.app_metadata?.original_user_id;
        
        if (!suspendedProviderData || !originalUserId) {
            throw new MedusaError(MedusaError.Types.INVALID_DATA, "Missing suspended provider data or original user ID");
        }
        
        // Recreate the provider identity
        const recreatedProviderIdentity = await authModule.createProviderIdentities([{
            entity_id: suspendedProviderData.entity_id as string,
            provider: suspendedProviderData.provider as string,
            provider_metadata: suspendedProviderData.provider_metadata,
            user_metadata: suspendedProviderData.user_metadata,
            auth_identity_id: authIdentity.id
        }]);
        
        // Clean up suspension metadata and restore user_id
        const updatedAuthIdentity = await authModule.updateAuthIdentities([{
            id: authIdentity.id,
            app_metadata: {
                user_id: originalUserId,
                // Remove all suspension-related metadata
                suspended: undefined,
                suspended_at: undefined,
                suspended_by: undefined,
                original_user_id: undefined,
                suspended_provider_data: undefined
            }
        }]);
        
        return new StepResponse({
            authIdentity: updatedAuthIdentity[0],
            providerIdentity: recreatedProviderIdentity[0]
        }, {
            authIdentityId: authIdentity.id,
            providerIdentityId: recreatedProviderIdentity[0].id,
            previousMetadata: authIdentity.app_metadata
        });
    },
    async (rollbackData, { container }) => {
        // Rollback: delete recreated provider identity and restore suspension metadata
        if (!rollbackData) return;
        
        const authModule = container.resolve(Modules.AUTH) as IAuthModuleService;
        
        // Delete the recreated provider identity
        await authModule.deleteProviderIdentities([rollbackData.providerIdentityId]);
        
        // Restore previous metadata
        await authModule.updateAuthIdentities([{
            id: rollbackData.authIdentityId,
            app_metadata: rollbackData.previousMetadata
        }]);
    }
);

// Step 4: Update user metadata to remove suspended flag
export const updateUserAfterUnsuspendStep = createStep(
    "update-user-after-unsuspend-step",
    async (userId: string, { container }) => {
        const userModule = container.resolve(Modules.USER) as IUserModuleService;
        
        // Get current user to preserve other metadata
        const currentUser = await userModule.retrieveUser(userId);
        
        const updatedUser = await userModule.updateUsers({
            id: userId,
            metadata: {
                ...currentUser.metadata,
                suspended: false,
                suspended_at: undefined
            }
        });
        
        return new StepResponse(updatedUser, {
            userId,
            previousMetadata: currentUser.metadata
        });
    },
    async (rollbackData, { container }) => {
        // Rollback: restore previous user metadata
        if (!rollbackData) return;
        
        const userModule = container.resolve(Modules.USER) as IUserModuleService;
        await userModule.updateUsers({
            id: rollbackData.userId,
            metadata: rollbackData.previousMetadata
        });
    }
);

// The workflow definition
export const unsuspendUserWorkflow = createWorkflow(
    "unsuspend-user-workflow",
    (input: { userId: string }) => {
        // Step 1: Validate and retrieve suspended user
        const user = findUserToUnsuspendStep(input);
        
        // Step 2: Find the suspended auth identity
        const suspendedAuthIdentity = findSuspendedAuthIdentityStep(user);
        
        // Step 3: Recreate provider identity and clean up suspension metadata
        const restorationResult = recreateProviderIdentityStep(suspendedAuthIdentity);
        
        // Step 4: Update user metadata to remove suspension
        const updatedUser = updateUserAfterUnsuspendStep(input.userId);

        // Return the results
        return new WorkflowResponse({
            user: updatedUser,
            authIdentity: restorationResult.authIdentity,
            providerIdentity: restorationResult.providerIdentity
        });
    }
);

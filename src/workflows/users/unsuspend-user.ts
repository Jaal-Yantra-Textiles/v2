import { MedusaError, Modules } from "@medusajs/framework/utils";
import { setAuthAppMetadataStep } from "@medusajs/medusa/core-flows";
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/workflows-sdk";
import { AuthIdentityDTO, UserDTO } from "@medusajs/types";

// Step 1: Find user and check if they are suspended
export const findUserToUnsuspendStep = createStep(
    "find-user-to-unsuspend-step",
    async (input: { userId: string }, { container }) => {
        const userModule = container.resolve(Modules.USER);
        const user = await userModule.retrieveUser(input.userId);

        if (!user.metadata?.suspended) {
            throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "User is not suspended");
        }
        return new StepResponse(user);
    },
);

// Step 2: Find the auth identity with the stored password and email
export const findAuthIdentityToRestoreStep = createStep(
    "find-auth-identity-to-restore-step",
    async (user: UserDTO, { container }) => {
        const authModule = container.resolve(Modules.AUTH);
        const authIdentities = await authModule.listAuthIdentities({
            app_metadata: {
                suspended: true,
                email: user.email
            }
        });

        if (!authIdentities.length) {
            throw new MedusaError(MedusaError.Types.NOT_FOUND, `No suspended auth identity found for user ${user.email}`);
        }

        return new StepResponse(authIdentities[0]);
    },
);

// Step 3: Re-create the provider identity
export const restoreProviderIdentityStep = createStep(
    "restore-provider-identity-step",
    async (authIdentity: AuthIdentityDTO, { container }) => {
        const authModule = container.resolve(Modules.AUTH);
        const password = authIdentity.app_metadata?.password;
        const email = authIdentity.app_metadata?.email;

        if (typeof password !== 'string' || typeof email !== 'string') {
            throw new MedusaError(MedusaError.Types.INVALID_DATA, "Missing or invalid password or email in auth identity metadata");
        }

        const createdProviderIdentity = await authModule.createProviderIdentities([
            {
            auth_identity_id: authIdentity.id,
            provider: "emailpass",
            provider_metadata: {
                password: password
            },
            entity_id: email
            }
    ]);

        return new StepResponse(createdProviderIdentity);
    },
);

// Step 4: Update user metadata to remove suspended flag
export const updateUserAfterUnsuspendStep = createStep(
    "update-user-after-unsuspend-step",
    async (userId: string, { container }) => {
        const userModule = container.resolve(Modules.USER);
        const users = await userModule.updateUsers([{
            id: userId,
            metadata: {
                suspended: false
            }
        }]);
        return new StepResponse(users[0]);
    },
);

// The workflow definition
export const unsuspendUserWorkflow = createWorkflow(
    "unsuspend-user-workflow",
    (input: { userId: string }) => {
        const user = findUserToUnsuspendStep(input);
        const authIdentity = findAuthIdentityToRestoreStep(user);

        // Restore the auth identity link to the user
        setAuthAppMetadataStep({
            authIdentityId: authIdentity.id,
            actorType: "user",
            value: user.id
        });
        
        // Re-create the provider identity
        restoreProviderIdentityStep(authIdentity);
        
        // Update the user's metadata
        const updatedUser = updateUserAfterUnsuspendStep(user.id);

        return new WorkflowResponse(updatedUser);
    }
);

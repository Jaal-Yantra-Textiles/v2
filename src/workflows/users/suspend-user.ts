import { MedusaError, Modules } from "@medusajs/framework/utils";
import { setAuthAppMetadataStep } from "@medusajs/medusa/core-flows";
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/workflows-sdk";
import { AuthIdentityDTO, ProviderIdentityDTO, UserDTO } from "@medusajs/types";

export const listAuthIdentitiesStep = createStep(
    "list-auth-identities-step",
    async ( user: UserDTO , { container }) => {
        const authModule = container.resolve(Modules.AUTH)
        const authIdentities = await authModule.listProviderIdentities({
            entity_id: user.email!
        })
        const authIdentity = authIdentities[0]
        const authIdentityMetadata = authModule.retrieveAuthIdentity(
            authIdentity.auth_identity_id!
        )
        const appMetadata = (await authIdentityMetadata).app_metadata
        if (appMetadata?.user_id == null) {
            throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Already suspended")
        }
        return new StepResponse(authIdentity)
    },
)



export const listUserStep = createStep(
    "list-user-step",
    async (input: { userId: string }, { container }) => {
        const userModule = container.resolve(Modules.USER)
        const user: UserDTO = await userModule.retrieveUser(input.userId)
        const checkAuthMetaDataExist = user.metadata?.suspended
        if (checkAuthMetaDataExist) {
            throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Already suspended")
        }
        return new StepResponse(user)
    },
)


export const updateUserMetaData = createStep(
    "update-user-metadata-step",
    async ( userId: string , { container }) => {
        const userModule = container.resolve(Modules.USER)
        const user = await userModule.updateUsers({
            id: userId,
            metadata: {
                suspended: true
            }
        })
        return new StepResponse(user)
    },
)


export const deleteAuthIdentityStep = createStep(
    "delete-auth-identity-step",
    async ( input: { id: string } , { container }) => {
        const authModule = container.resolve(Modules.AUTH)
        // before we delete we copy the password 
        const authIdentity = await authModule.retrieveProviderIdentity(input.id)
        console.log(authIdentity)
        await authModule.updateAuthIdentities([{
            id: authIdentity.auth_identity?.id!,
            app_metadata: {
                suspended: true,
                password: authIdentity.provider_metadata?.password,
                email: authIdentity.entity_id
            }
        }])

        const deletedAuthIdentity = await authModule.deleteProviderIdentities([
            input.id,
        ])
        return new StepResponse(deletedAuthIdentity)
    },
)


export const suspendUserWorkflow = createWorkflow(
    "suspend-user-workflow",
    (input: { userId: string }) => {
        const user = listUserStep(input);
        const authIdentities = listAuthIdentitiesStep(user);

        // This step now handles the full suspension logic
        deleteAuthIdentityStep({
            id: authIdentities.id!
        });
        
        // This step updates the user's record for internal tracking
        const updatedUser = updateUserMetaData(input.userId);

        // Return the final state of the user
        return new WorkflowResponse(updatedUser);
    }
);

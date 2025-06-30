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
        if (appMetadata) {
            appMetadata.user_id == null
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


export const suspendUserWorkflow = createWorkflow(
    "suspend-user-workflow",
    (input: { userId: string }) => {
        const user = listUserStep(input)
        const authIdentities = listAuthIdentitiesStep(user)
        const suspendUser = setAuthAppMetadataStep({
            authIdentityId: authIdentities.auth_identity_id!,
            actorType: "user",
            value: null, 
        })
        const updateUser = updateUserMetaData(input.userId)
        return new WorkflowResponse(suspendUser)
    }
    
)

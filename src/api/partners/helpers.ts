import { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export const refetchPartner = async (
    partnerId: string,
    container: MedusaContainer,
) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const result = await query.graph({
        entity: "partners",
        filters: {
            id: partnerId
        },
        fields: ["*", "admins.id", "admins.first_name", "admins.last_name", "admins.email",
            "admins.phone", "admins.role", "admins.permissions", "admins.metadata", 
            "admins.created_at", "admins.updated_at"
        ]
    })
    const data = result.data || []
    return data[0]
}

export const getPartnerFromAuthContext = async (
    authContext: { actor_id?: string | null } | undefined,
    container: MedusaContainer,
): Promise<any | null> => {
    const partnerId = authContext?.actor_id
    if (!partnerId) {
        return null
    }

    const partner = await refetchPartner(partnerId, container)
    return partner || null
}
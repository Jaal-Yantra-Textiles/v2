import { MedusaContainer } from "@medusajs/framework"

export const refetchPartner = async (
    partnerId: string,
    container: MedusaContainer,
) => {
    const query = container.resolve("query")
    const { data: partner } = await query.graph({
        entity: "partners",
        filters: {
            id: partnerId
        },
        fields: ["*", "admins.id", "admins.first_name", "admins.last_name", "admins.email",
            "admins.phone", "admins.role", "admins.permissions", "admins.metadata", 
            "admins.created_at", "admins.updated_at"
        ]
    })
    return partner[0]
}


export const refetchPartnerForThisAdmin = async (
    adminId: string,
    container: MedusaContainer,
) => {
    const query = container.resolve("query")
    const { data: partner } = await query.graph({
        entity: "partners",
        filters: {
            admins: {
                id: adminId
            }
        },
        fields: ["*", "admins.id", "admins.first_name", "admins.last_name", "admins.email",
            "admins.phone", "admins.role", "admins.permissions", "admins.metadata", 
            "admins.created_at", "admins.updated_at"
        ]
    })
   
    return partner[0]
}

/**
 * Get partner from actor ID, handling both old and new auth flows
 * - New auth: actor_id is the partner ID directly
 * - Old auth: actor_id is the admin user ID
 */
export const getPartnerFromActorId = async (
    actorId: string,
    container: MedusaContainer,
): Promise<any> => {
    // Try to fetch partner by ID first (new auth flow)
    let partner = await refetchPartner(actorId, container)
    
    // If not found, try to fetch by admin ID (old auth flow)
    if (!partner) {
        partner = await refetchPartnerForThisAdmin(actorId, container)
    }
    
    return partner
}
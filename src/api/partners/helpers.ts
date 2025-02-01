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
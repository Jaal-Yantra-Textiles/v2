import { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

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

export const validatePartnerStoreAccess = async (
    authContext: { actor_id?: string | null } | undefined,
    storeId: string,
    container: MedusaContainer,
): Promise<{ partner: any; store: any }> => {
    const partner = await getPartnerFromAuthContext(authContext, container)
    if (!partner) {
        throw new MedusaError(
            MedusaError.Types.UNAUTHORIZED,
            "No partner associated with this account"
        )
    }

    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
        entity: "partners",
        fields: ["id", "stores.*"],
        filters: { id: partner.id },
    })

    const stores = (data?.[0]?.stores || []) as any[]
    const store = stores.find((s: any) => s.id === storeId)

    if (!store) {
        throw new MedusaError(
            MedusaError.Types.UNAUTHORIZED,
            `Store ${storeId} is not associated with this partner`
        )
    }

    return { partner, store }
}

export const getPartnerStore = async (
    authContext: { actor_id?: string | null } | undefined,
    container: MedusaContainer,
): Promise<{ partner: any; store: any }> => {
    const partner = await getPartnerFromAuthContext(authContext, container)
    if (!partner) {
        throw new MedusaError(
            MedusaError.Types.UNAUTHORIZED,
            "No partner associated with this account"
        )
    }

    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
        entity: "partners",
        fields: ["id", "stores.*"],
        filters: { id: partner.id },
    })

    const stores = (data?.[0]?.stores || []) as any[]
    if (!stores.length) {
        throw new MedusaError(
            MedusaError.Types.NOT_FOUND,
            "No store configured for this partner"
        )
    }

    return { partner, store: stores[0] }
}

export const validatePartnerEntityOwnership = async (
    authContext: { actor_id?: string | null } | undefined,
    entityType: "product_categories" | "product_collections" | "customers" | "customer_groups",
    entityId: string,
    container: MedusaContainer,
): Promise<{ partner: any; store: any }> => {
    const { partner, store } = await getPartnerStore(authContext, container)

    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
        entity: "stores",
        fields: [`${entityType}.id`],
        filters: { id: store.id },
    })

    const entities = (data?.[0] as any)?.[entityType] || []
    const found = entities.some((e: any) => e.id === entityId)

    if (!found) {
        throw new MedusaError(
            MedusaError.Types.NOT_FOUND,
            `${entityType.replace("_", " ")} not found`
        )
    }

    return { partner, store }
}
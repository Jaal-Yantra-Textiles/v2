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

/**
 * Non-throwing variant of getPartnerStore.
 * Returns { partner, store: null } when the partner has no store linked.
 */
export const tryGetPartnerStore = async (
    authContext: { actor_id?: string | null } | undefined,
    container: MedusaContainer,
): Promise<{ partner: any; store: any | null }> => {
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
    return { partner, store: stores[0] || null }
}

/**
 * Non-throwing variant of getPartnerSalesChannelId.
 * Returns { partner, store, salesChannelId: null } when no store or no sales channel.
 */
export const tryGetPartnerSalesChannelId = async (
    authContext: { actor_id?: string | null } | undefined,
    container: MedusaContainer,
): Promise<{ partner: any; store: any | null; salesChannelId: string | null }> => {
    const { partner, store } = await tryGetPartnerStore(authContext, container)
    if (!store || !store.default_sales_channel_id) {
        return { partner, store, salesChannelId: null }
    }
    return { partner, store, salesChannelId: store.default_sales_channel_id }
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

/**
 * Validates that an order belongs to the partner's store via sales channel.
 */
export const validatePartnerOrderOwnership = async (
    authContext: { actor_id?: string | null } | undefined,
    orderId: string,
    container: MedusaContainer,
): Promise<{ partner: any; store: any }> => {
    const { partner, store } = await getPartnerStore(authContext, container)

    if (!store.default_sales_channel_id) {
        throw new MedusaError(
            MedusaError.Types.NOT_FOUND,
            "Store has no sales channel configured"
        )
    }

    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data: orders } = await query.graph({
        entity: "orders",
        fields: ["id", "sales_channel_id"],
        filters: { id: orderId },
    })

    const order = orders?.[0] as any
    if (!order || order.sales_channel_id !== store.default_sales_channel_id) {
        throw new MedusaError(MedusaError.Types.NOT_FOUND, "Order not found")
    }

    return { partner, store }
}

/**
 * Validates that a return/exchange/claim belongs to the partner's store via its order.
 * Looks up the entity by ID, gets its order_id, then checks the order's sales channel.
 */
export const validatePartnerOrderEntityOwnership = async (
    authContext: { actor_id?: string | null } | undefined,
    entityType: "return" | "exchange" | "claim",
    entityId: string,
    container: MedusaContainer,
): Promise<{ partner: any; store: any; orderId: string }> => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const entityName = entityType === "return" ? "return" : entityType === "exchange" ? "order_exchange" : "order_claim"
    const { data } = await query.graph({
        entity: entityName,
        fields: ["id", "order_id"],
        filters: { id: entityId },
    } as any)

    const entity = data?.[0] as any
    if (!entity?.order_id) {
        throw new MedusaError(MedusaError.Types.NOT_FOUND, `${entityType} not found`)
    }

    const { partner, store } = await validatePartnerOrderOwnership(authContext, entity.order_id, container)
    return { partner, store, orderId: entity.order_id }
}

/**
 * Gets the partner's sales channel ID for order scoping.
 */
export const getPartnerSalesChannelId = async (
    authContext: { actor_id?: string | null } | undefined,
    container: MedusaContainer,
): Promise<{ partner: any; store: any; salesChannelId: string }> => {
    const { partner, store } = await getPartnerStore(authContext, container)

    if (!store.default_sales_channel_id) {
        throw new MedusaError(
            MedusaError.Types.NOT_FOUND,
            "Store has no sales channel configured"
        )
    }

    return { partner, store, salesChannelId: store.default_sales_channel_id }
}
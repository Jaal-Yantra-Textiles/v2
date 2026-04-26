import { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Resolves the store linked to the publishable key's sales channel.
 * Flow: publishable key → sales_channel_ids → store with matching default_sales_channel_id
 */
export const getStoreFromPublishableKey = async (
  publishableKeyContext: { sales_channel_ids: string[] },
  container: MedusaContainer
): Promise<any | null> => {
  const salesChannelIds = publishableKeyContext.sales_channel_ids
  if (!salesChannelIds?.length) {
    return null
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  // Find the store that has one of these sales channels as its default
  const { data: stores } = await query.graph({
    entity: "stores",
    fields: ["*"],
    filters: {
      default_sales_channel_id: salesChannelIds,
    },
  })

  return stores?.[0] || null
}

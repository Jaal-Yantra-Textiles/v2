import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  createApiKeysWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
} from "@medusajs/medusa/core-flows"

/**
 * Backfill publishable API keys for existing partner stores that don't have one.
 *
 * Run: npx medusa exec ./src/scripts/backfill-publishable-keys.ts
 */
export default async function backfillPublishableKeys({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  logger.info("Starting publishable API key backfill for partner stores...")

  // 1. Get all partners with their stores
  const { data: partners } = await query.graph({
    entity: "partners",
    fields: ["id", "name", "handle", "stores.*"],
  })

  if (!partners?.length) {
    logger.info("No partners found. Nothing to backfill.")
    return
  }

  // 2. Get all existing publishable API keys with their sales channels
  const { data: existingKeys } = await query.graph({
    entity: "api_keys",
    fields: ["id", "title", "token", "type", "sales_channels.*"],
    filters: { type: "publishable" },
  })

  // Build a set of sales channel IDs that already have a publishable key
  const coveredSalesChannelIds = new Set<string>()
  for (const key of existingKeys || []) {
    for (const sc of (key as any).sales_channels || []) {
      coveredSalesChannelIds.add(sc.id)
    }
  }

  let created = 0
  let skipped = 0

  for (const partner of partners) {
    const stores = (partner as any).stores || []

    for (const store of stores) {
      const salesChannelId = store.default_sales_channel_id

      if (!salesChannelId) {
        logger.warn(
          `Partner "${partner.name}" (${partner.id}), store ${store.id}: no default_sales_channel_id — skipping`
        )
        skipped++
        continue
      }

      if (coveredSalesChannelIds.has(salesChannelId)) {
        logger.info(
          `Partner "${partner.name}" (${partner.id}), store "${store.name}": already has a publishable key — skipping`
        )
        skipped++
        continue
      }

      // Create publishable key
      const title = `${store.name || partner.name} - Publishable Key`
      logger.info(
        `Partner "${partner.name}" (${partner.id}), store "${store.name}": creating key "${title}"...`
      )

      const { result } = await createApiKeysWorkflow(container).run({
        input: {
          api_keys: [
            {
              title,
              type: "publishable",
              created_by: "",
            },
          ],
        },
      })

      const apiKey = result[0]

      // Link to sales channel
      await linkSalesChannelsToApiKeyWorkflow(container).run({
        input: {
          id: apiKey.id,
          add: [salesChannelId],
        },
      })

      coveredSalesChannelIds.add(salesChannelId)
      created++

      logger.info(
        `  Created key ${apiKey.id} (token: ${apiKey.token}) linked to sales channel ${salesChannelId}`
      )
    }
  }

  logger.info(
    `Backfill complete. Created: ${created}, Skipped: ${skipped}, Total partners: ${partners.length}`
  )
}

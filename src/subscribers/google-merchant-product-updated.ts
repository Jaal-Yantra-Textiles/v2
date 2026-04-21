import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { syncProductToGoogleWorkflow } from "../workflows/google_merchant"

const LINK_ENTITY = "product_product_google_merchant_google_merchant_account"

export default async function googleMerchantProductUpdatedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  if (!data?.id) return

  const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
  const logger = container.resolve("logger") as any

  let links: any[] = []
  try {
    const res = await query.graph({
      entity: LINK_ENTITY,
      fields: ["product_id", "google_merchant_account_id", "sync_status", "metadata"],
      filters: { product_id: data.id },
    })
    links = res?.data || []
  } catch (e: any) {
    logger?.warn?.(`[google-merchant auto-resync] link lookup failed for product ${data.id}: ${e.message}`)
    return
  }

  if (links.length === 0) return

  for (const link of links) {
    if (!link?.google_merchant_account_id) continue
    if (link?.metadata?.externally_managed) continue
    syncProductToGoogleWorkflow(container)
      .run({
        input: {
          product_id: data.id,
          account_id: link.google_merchant_account_id,
        },
      })
      .catch((e: any) => {
        logger?.warn?.(
          `[google-merchant auto-resync] product ${data.id} → account ${link.google_merchant_account_id}: ${e.message}`
        )
      })
  }
}

export const config: SubscriberConfig = {
  event: ["product.updated"],
}

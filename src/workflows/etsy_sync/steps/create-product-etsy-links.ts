import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { ETSYSYNC_MODULE } from "../../../modules/etsysync"

export type CreateProductEtsyLinksInput = {
  product_ids: string[]
  etsy_account_id: string
}

/**
 * Creates pending product-etsy links for all products in the sync job.
 * These links will be updated with listing IDs and status by the batch sync step.
 */
export const createProductEtsyLinksStep = createStep(
  "create-product-etsy-links-step",
  async (input: CreateProductEtsyLinksInput, { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK)

    const linksToCreate = input.product_ids.map((product_id) => ({
      [Modules.PRODUCT]: {
        product_id,
      },
      [ETSYSYNC_MODULE]: {
        etsy_account_id: input.etsy_account_id,
      },
      data: {
        sync_status: "pending",
        etsy_listing_id: null,
        etsy_url: null,
        last_synced_at: null,
        sync_error: null,
        metadata: {},
      },
    }))

    await remoteLink.create(linksToCreate)

    return new StepResponse(
      { created: input.product_ids.length },
      { product_ids: input.product_ids, etsy_account_id: input.etsy_account_id }
    )
  },
  async (compensationData, { container }) => {
    if (!compensationData) return

    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK)

    // Dismiss the links we created
    const linksToDismiss = compensationData.product_ids.map((product_id) => ({
      [Modules.PRODUCT]: {
        product_id,
      },
      [ETSYSYNC_MODULE]: {
        etsy_account_id: compensationData.etsy_account_id,
      },
    }))

    await remoteLink.dismiss(linksToDismiss)
  }
)

import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  WorkflowData,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { Link } from "@medusajs/modules-sdk"
import { ETSY_SYNC_MODULE } from "../modules/etsy-sync"
import EtsySyncService from "../modules/etsy-sync/service"

export const DELETE_LISTING_FROM_ETSY = "etsy-delete-listing"

export type DeleteListingFromEtsyInput = {
  product_id: string
}

type DeleteResult = {
  product_id: string
  listing_id: string | null
  deleted: boolean
  warnings: string[]
}

// ── Step: delete the Etsy listing + clean up the local link/record ─────────

const deleteEtsyListingStep = createStep(
  "etsy-delete-listing-step",
  async (
    input: { product_id: string },
    { container }
  ): Promise<StepResponse<DeleteResult>> => {
    const service: EtsySyncService = container.resolve(ETSY_SYNC_MODULE)
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
    const client = service.getClient()

    const account = await service.ensureFreshToken()
    const warnings: string[] = []

    // Find the linked Etsy listing for this product.
    let listing_id: string | null = null
    try {
      const linkRows = await remoteLink.list({
        [Modules.PRODUCT]: { product_id: input.product_id },
        [ETSY_SYNC_MODULE]: { etsy_sync_account_id: account.id },
      })
      const row: any = (linkRows as any[])?.[0]
      listing_id = row?.etsy_listing_id ?? null
    } catch {
      // no link
    }

    // Delete the remote listing. A 404 means it's already gone on Etsy — treat
    // that as success so re-deleting (or deleting an already-removed listing)
    // still cleans up our side.
    if (listing_id) {
      try {
        await client.deleteListing(account.access_token, listing_id)
      } catch (err: any) {
        const msg = String(err?.message || err)
        if (/404|not found/i.test(msg)) {
          warnings.push("Listing was already removed on Etsy.")
        } else {
          // Surface the error but still clear our link so the product isn't stuck
          // pointing at a listing we can't manage.
          warnings.push(`Etsy delete failed: ${msg}`)
        }
      }
    } else {
      warnings.push("No linked Etsy listing found for this product.")
    }

    // Drop the product↔account link so the product reads as un-synced.
    try {
      await remoteLink.dismiss([
        {
          [Modules.PRODUCT]: { product_id: input.product_id },
          [ETSY_SYNC_MODULE]: { etsy_sync_account_id: account.id },
        },
      ])
    } catch {
      // ignore dismiss errors
    }

    // Historical record of the removal.
    await service.createSyncRecord({
      product_id: input.product_id,
      account_id: account.id,
      listing_id,
      listing_url: null,
      listing_state: "deleted",
      action: "delete",
      status: "success",
      published: false,
      error_message: warnings.length ? warnings.join(" | ") : null,
      warnings,
      metadata: {},
      synced_at: new Date(),
    } as any)

    return new StepResponse({
      product_id: input.product_id,
      listing_id,
      deleted: Boolean(listing_id),
      warnings,
    })
  }
)

export const deleteListingFromEtsyWorkflow = createWorkflow(
  DELETE_LISTING_FROM_ETSY,
  (input: WorkflowData<DeleteListingFromEtsyInput>) => {
    const result = deleteEtsyListingStep(input)
    return new WorkflowResponse(result)
  }
)

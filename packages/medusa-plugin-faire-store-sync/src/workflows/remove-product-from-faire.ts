import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  WorkflowData,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { Link } from "@medusajs/modules-sdk"
import { FAIRE_SYNC_MODULE } from "../modules/faire-sync"
import FaireSyncService from "../modules/faire-sync/service"

export const REMOVE_PRODUCT_FROM_FAIRE = "faire-remove-product"

export type RemoveProductFromFaireInput = {
  product_id: string
}

type RemoveResult = {
  product_id: string
  product_token: string | null
  removed: boolean
  warnings: string[]
}

// ── Step: unpublish the Faire product + clean up the local link/record ─────
//
// Faire's public Brand API exposes no hard-delete for products (only
// POST/PUT/GET on /products), so "remove" means unpublish: set the product's
// lifecycle_state back to DRAFT via the update endpoint, which pulls it from
// buyers' view. A true hard-delete has to be done in the Faire brand portal.

const removeFaireProductStep = createStep(
  "faire-remove-product-step",
  async (
    input: { product_id: string },
    { container }
  ): Promise<StepResponse<RemoveResult>> => {
    const service: FaireSyncService = container.resolve(FAIRE_SYNC_MODULE)
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link

    const account = await service.ensureFreshToken()
    const client = service.getClient((account.auth_mode as "oauth" | "apiKey") ?? "oauth")
    const warnings: string[] = []

    // Find the linked Faire product for this product.
    let product_token: string | null = null
    try {
      const linkRows = await remoteLink.list({
        [Modules.PRODUCT]: { product_id: input.product_id },
        [FAIRE_SYNC_MODULE]: { faire_sync_account_id: account.id },
      })
      const row: any = (linkRows as any[])?.[0]
      product_token = row?.faire_product_token ?? null
    } catch {
      // no link
    }

    // Unpublish (DRAFT) so it disappears from the Faire storefront. Tolerate a
    // 404 — a product already gone on Faire still cleans up our side.
    if (product_token) {
      try {
        await client.updateProduct(account.access_token, product_token, {
          lifecycle_state: "DRAFT",
        })
      } catch (err: any) {
        const msg = String(err?.message || err)
        if (/404|not found/i.test(msg)) {
          warnings.push("Product was already removed on Faire.")
        } else {
          warnings.push(`Faire unpublish failed: ${msg}`)
        }
      }
    } else {
      warnings.push("No linked Faire product found for this product.")
    }

    // Drop the product↔account link so the product reads as un-synced.
    try {
      await remoteLink.dismiss([
        {
          [Modules.PRODUCT]: { product_id: input.product_id },
          [FAIRE_SYNC_MODULE]: { faire_sync_account_id: account.id },
        },
      ])
    } catch {
      // ignore dismiss errors
    }

    // Historical record of the removal.
    await service.createSyncRecord({
      product_id: input.product_id,
      account_id: account.id,
      product_token,
      product_url: null,
      product_state: "draft",
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
      product_token,
      removed: Boolean(product_token),
      warnings,
    })
  }
)

export const removeProductFromFaireWorkflow = createWorkflow(
  REMOVE_PRODUCT_FROM_FAIRE,
  (input: WorkflowData<RemoveProductFromFaireInput>) => {
    const result = removeFaireProductStep(input)
    return new WorkflowResponse(result)
  }
)

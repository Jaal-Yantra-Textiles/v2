import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { ARTISAN_PRODUCT_DETAIL_MODULE } from "../../modules/artisan-product-detail"

export type ArtisanProductDetailInput = {
  made_to_order?: boolean
  lead_time_days?: number | null
  lead_time_label?: string | null
  min_order_quantity?: number | null
  maker_story?: string | null
}

export type UpsertArtisanProductDetailInput = {
  product_id: string
  data: ArtisanProductDetailInput
}

/**
 * Upsert the artisan detail row for a product and ensure the product ↔ detail
 * module link exists (issue #859 S3 / #862). Idempotent: re-running updates the
 * existing row rather than creating a duplicate (product_id is unique).
 */
type UpsertCompensation = {
  created: boolean
  id: string
  product_id?: string
  prev?: ArtisanProductDetailInput
}

const upsertArtisanProductDetailStep = createStep(
  "upsert-artisan-product-detail",
  async (input: UpsertArtisanProductDetailInput, { container }) => {
    const service: any = container.resolve(ARTISAN_PRODUCT_DETAIL_MODULE)
    const link: any = container.resolve(ContainerRegistrationKeys.LINK)

    const existing = await service.findByProduct(input.product_id)

    let detail: any
    let compensation: UpsertCompensation
    if (existing) {
      detail = await service.updateArtisanProductDetails({
        id: existing.id,
        ...input.data,
      })
      // Return the prior values so a failed downstream step can restore them.
      compensation = {
        created: false,
        id: existing.id,
        prev: {
          made_to_order: existing.made_to_order,
          lead_time_days: existing.lead_time_days,
          lead_time_label: existing.lead_time_label,
          min_order_quantity: existing.min_order_quantity,
          maker_story: existing.maker_story,
        },
      }
    } else {
      detail = await service.createArtisanProductDetails({
        product_id: input.product_id,
        ...input.data,
      })
      compensation = {
        created: true,
        id: detail.id,
        product_id: input.product_id,
      }
    }

    // Ensure the product ↔ detail link on BOTH paths (idempotent). Previously
    // the link was created only on the first-create branch, so a row whose link
    // never persisted (e.g. link-migration lag when the row was first written)
    // stayed unlinked forever — readable by the module via its `product_id`
    // column, but invisible to `query.graph`, so the storefront preview/PDP
    // silently dropped the maker story (#859). Re-creating an existing link is a
    // no-op, so this safely self-heals such rows on the next save.
    await link.create({
      [Modules.PRODUCT]: { product_id: input.product_id },
      [ARTISAN_PRODUCT_DETAIL_MODULE]: {
        artisan_product_detail_id: detail.id,
      },
    })

    return new StepResponse(detail, compensation)
  },
  async (compensation: UpsertCompensation | undefined, { container }) => {
    if (!compensation) return
    const service: any = container.resolve(ARTISAN_PRODUCT_DETAIL_MODULE)
    const link: any = container.resolve(ContainerRegistrationKeys.LINK)

    if (compensation.created) {
      await link
        .dismiss({
          [Modules.PRODUCT]: { product_id: compensation.product_id },
          [ARTISAN_PRODUCT_DETAIL_MODULE]: {
            artisan_product_detail_id: compensation.id,
          },
        })
        .catch(() => {})
      await service.deleteArtisanProductDetails(compensation.id)
      return
    }

    await service.updateArtisanProductDetails({
      id: compensation.id,
      ...compensation.prev,
    })
  }
)

export const upsertArtisanProductDetailWorkflow = createWorkflow(
  "upsert-artisan-product-detail",
  (input: UpsertArtisanProductDetailInput) => {
    const detail = upsertArtisanProductDetailStep(input)
    return new WorkflowResponse(detail)
  }
)

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

    if (existing) {
      const updated = await service.updateArtisanProductDetails({
        id: existing.id,
        ...input.data,
      })
      // Return the prior values so a failed downstream step can restore them.
      const compensation: UpsertCompensation = {
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
      return new StepResponse(updated, compensation)
    }

    const created = await service.createArtisanProductDetails({
      product_id: input.product_id,
      ...input.data,
    })

    await link.create({
      [Modules.PRODUCT]: { product_id: input.product_id },
      [ARTISAN_PRODUCT_DETAIL_MODULE]: {
        artisan_product_detail_id: created.id,
      },
    })

    const compensation: UpsertCompensation = {
      created: true,
      id: created.id,
      product_id: input.product_id,
    }
    return new StepResponse(created, compensation)
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

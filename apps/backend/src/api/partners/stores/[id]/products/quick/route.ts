import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, ProductStatus } from "@medusajs/framework/utils"
import { batchInventoryItemLevelsWorkflow } from "@medusajs/medusa/core-flows"
import {
  ensureInventoryLevelsForVariants,
  validatePartnerStoreAccess,
} from "../../../../helpers"
import { createPartnerProductWorkflow } from "../../../../../../workflows/partner/create-partner-product"

/**
 * POST /partners/stores/:id/products/quick
 *
 * One-shot product creation for partners who don't need the full variant /
 * pricing / stock surface. Composes createProductsWorkflow (product + one
 * default option + one variant + one price) and batchInventoryItemLevelsWorkflow
 * (seeds stock at the store's default location). Uses store defaults
 * (default currency, default sales channel, default location).
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { partner } = await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  // Refetch the store with supported_currencies — the validator only loads
  // the bare store row so we need the full shape for default currency.
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: stores } = await query.graph({
    entity: "store",
    fields: [
      "id",
      "default_sales_channel_id",
      "default_location_id",
      "supported_currencies.currency_code",
      "supported_currencies.is_default",
    ],
    filters: { id: req.params.id },
  })
  const store = stores?.[0] as any
  if (!store) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Store not found")
  }

  const body = (req.body ?? {}) as {
    title?: string
    description?: string | null
    thumbnail?: string | null
    images?: string[]
    price?: number
    stock_quantity?: number
    status?: ProductStatus
  }

  if (!body.title || typeof body.title !== "string") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "title is required")
  }
  if (typeof body.price !== "number" || body.price < 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "price must be a non-negative number"
    )
  }
  if (body.stock_quantity !== undefined) {
    if (typeof body.stock_quantity !== "number" || body.stock_quantity < 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "stock_quantity must be a non-negative number"
      )
    }
  }

  const supported = (store.supported_currencies || []) as Array<{
    currency_code: string
    is_default: boolean
  }>
  const currencyCode =
    supported.find((c) => c.is_default)?.currency_code ??
    supported[0]?.currency_code
  if (!currencyCode) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Store has no default currency configured"
    )
  }
  if (!store.default_sales_channel_id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Store has no default sales channel configured"
    )
  }

  const productTitle = body.title.trim()
  const productInput: any = {
    title: productTitle,
    description: body.description?.trim() || undefined,
    status: body.status ?? ProductStatus.PUBLISHED,
    thumbnail: body.thumbnail || body.images?.[0] || undefined,
    images: body.images?.length ? body.images.map((url) => ({ url })) : undefined,
    options: [
      { title: "Default option", values: ["Default option value"] },
    ],
    variants: [
      {
        title: productTitle,
        options: { "Default option": "Default option value" },
        manage_inventory: true,
        prices: [{ amount: body.price, currency_code: currencyCode }],
      },
    ],
  }

  // #1380 — the shared create workflow (sales channel + FX fanout + the gate).
  //
  // `seedInventoryLevels: false` is deliberate and is the one place the shared
  // seeding must NOT run: this route writes a REAL quantity at the store's
  // default location a few lines down. If the workflow seeded a 0-qty level
  // first and that location is linked to the sales channel, both would target
  // the same (inventory_item, location) pair and the create below would collide.
  // The seeding still happens — after, via the same helper, where it can see the
  // level this route wrote and fill in only what is missing.
  const { result } = await createPartnerProductWorkflow(req.scope).run({
    input: {
      partnerId: partner.id,
      storeId: store.id,
      product: productInput,
      seedInventoryLevels: false,
    },
  })

  const product = result.product as any

  // Seed stock at the store's default location (if set and the user asked for it).
  if (
    store.default_location_id &&
    body.stock_quantity !== undefined &&
    body.stock_quantity > 0
  ) {
    const { data: refreshed } = await query.graph({
      entity: "products",
      fields: [
        "variants.id",
        "variants.manage_inventory",
        "variants.inventory_items.inventory.id",
      ],
      filters: { id: product.id },
    })

    const itemIds: string[] = []
    const variants = (refreshed?.[0] as any)?.variants || []
    for (const v of variants) {
      if (!v.manage_inventory) continue
      for (const ii of v.inventory_items || []) {
        if (ii?.inventory?.id) itemIds.push(ii.inventory.id)
      }
    }

    if (itemIds.length > 0) {
      await batchInventoryItemLevelsWorkflow(req.scope).run({
        input: {
          create: itemIds.map((inventory_item_id) => ({
            inventory_item_id,
            location_id: store.default_location_id!,
            stocked_quantity: body.stock_quantity!,
          })),
          update: [],
          delete: [],
        } as any,
      })
    }
  }

  // Close the gap this route has always had: its variants are ALWAYS
  // `manage_inventory: true`, but the stock seeding above only runs when the
  // caller passed a quantity. Without a level, partner-ui 404s on the item.
  // Runs last so it observes any level written above and only fills the rest.
  await ensureInventoryLevelsForVariants(
    req.scope,
    store,
    (product?.variants || []).map((v: any) => v.id)
  )

  res.status(201).json({ product })
}

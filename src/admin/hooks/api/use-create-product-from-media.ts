import { useMutation, useQuery } from "@tanstack/react-query";
import { sdk } from "../../lib/config";
import { toast } from "@medusajs/ui";

export const useDefaultSalesChannel = () => {
  return useQuery({
    queryKey: ["store-default-sales-channel"],
    queryFn: async () => {
      // store.retrieve() requires an explicit store ID and doesn't reliably return
      // default_sales_channel_id without it — go straight to salesChannel.list()
      const { sales_channels } = await sdk.admin.salesChannel.list({
        limit: 10,
        fields: "id,name,is_disabled",
      })
      // Prefer an enabled channel
      const active = sales_channels?.find((sc: any) => !sc.is_disabled) ?? sales_channels?.[0]
      return active ? [{ id: active.id }] : []
    },
    staleTime: 5 * 60 * 1000,
  })
}

const SIZES = ["S", "M", "L"] as const

export type SizeQuantities = { S?: number; M?: number; L?: number }

export type CreateProductFromMediaPayload = {
  title: string
  mediaFiles: Array<{ id: string; url: string }>
  folderId: string
  /** Price in dollars (e.g. 29.99). Applied to all size variants in USD. */
  price?: number
  /** Whether to enable inventory tracking for all variants. */
  manageInventory?: boolean
  /** Per-size stock quantities. Only used when manageInventory=true. */
  quantities?: SizeQuantities
}

export const useCreateProductFromMedia = () => {
  return useMutation({
    mutationFn: async ({
      title,
      mediaFiles,
      folderId,
      price,
      manageInventory = false,
      quantities,
    }: CreateProductFromMediaPayload) => {
      // Resolve sales channel — use first active channel
      const { sales_channels } = await sdk.admin.salesChannel.list({
        limit: 10,
        fields: "id,is_disabled",
      })
      const activeChannel = sales_channels?.find((sc: any) => !sc.is_disabled) ?? sales_channels?.[0]
      const salesChannelId = activeChannel?.id

      const thumbnail = mediaFiles[0]?.url
      const images = mediaFiles.map((f) => ({ url: f.url }))

      // Convert dollars → cents (Medusa stores amounts in smallest currency unit)
      const priceAmount = price != null && price > 0 ? Math.round(price * 100) : null

      const payload: any = {
        title,
        status: "draft",
        is_giftcard: false,
        discountable: true,
        thumbnail,
        images,
        metadata: {
          created_from_media: true,
          folder_id: folderId,
          media_ids: mediaFiles.map((f) => f.id),
        },
        options: [{ title: "Size", values: [...SIZES] }],
        variants: SIZES.map((size) => ({
          title: size,
          options: { Size: size },
          manage_inventory: manageInventory,
          prices: priceAmount ? [{ amount: priceAmount, currency_code: "usd" }] : [],
        })),
      }

      if (salesChannelId) {
        payload.sales_channels = [{ id: salesChannelId }]
      }

      const result = await sdk.admin.product.create(payload)
      const product = result.product

      // Set inventory levels if manage_inventory is on and any quantity was provided
      if (manageInventory && quantities && Object.values(quantities).some((q) => q != null && q > 0)) {
        await setInventoryLevels(product, quantities)
      }

      return product
    },
    onError: (error: any) => {
      toast.error(error?.message || "Failed to create product")
    },
  })
}

async function setInventoryLevels(product: any, quantities: SizeQuantities) {
  // Get first stock location
  const { stock_locations } = await sdk.admin.stockLocation.list({ limit: 1 })
  const locationId = stock_locations?.[0]?.id
  if (!locationId) return

  // Fetch product with inventory item IDs per variant
  const { product: full } = await sdk.admin.product.retrieve(product.id, {
    fields: "+variants.inventory_items.*",
  })

  for (const variant of full?.variants ?? []) {
    const size = variant.title as keyof SizeQuantities
    const qty = quantities[size]
    if (!qty || qty <= 0) continue

    const inventoryItemId = variant.inventory_items?.[0]?.inventory_item_id ?? variant.inventory_items?.[0]?.id
    if (!inventoryItemId) continue

    try {
      // Try to create a new level first
      await sdk.admin.inventoryItem.batchInventoryItemLocationLevels(inventoryItemId, {
        create: [{ location_id: locationId, stocked_quantity: qty }],
      })
    } catch {
      // Level already exists — update it
      await sdk.admin.inventoryItem.updateLevel(inventoryItemId, locationId, {
        stocked_quantity: qty,
      })
    }
  }
}

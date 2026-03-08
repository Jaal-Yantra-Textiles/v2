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

export type CreateProductFromMediaPayload = {
  title: string
  mediaFiles: Array<{ id: string; url: string }>
  folderId: string
  /** Price in dollars (e.g. 29.99). Applied to all size variants in USD. */
  price?: number
}

export const useCreateProductFromMedia = () => {
  return useMutation({
    mutationFn: async ({ title, mediaFiles, folderId, price }: CreateProductFromMediaPayload) => {
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
          manage_inventory: false,
          prices: priceAmount ? [{ amount: priceAmount, currency_code: "usd" }] : [],
        })),
      }

      if (salesChannelId) {
        payload.sales_channels = [{ id: salesChannelId }]
      }

      const result = await sdk.admin.product.create(payload)
      return result.product
    },
    onError: (error: any) => {
      toast.error(error?.message || "Failed to create product")
    },
  })
}

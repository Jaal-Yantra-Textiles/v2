import { useMutation, useQuery } from "@tanstack/react-query";
import { sdk } from "../../lib/config";
import { toast } from "@medusajs/ui";

export const useDefaultSalesChannel = () => {
  return useQuery({
    queryKey: ["store-default-sales-channel"],
    queryFn: async () => {
      const { store } = await sdk.admin.store.retrieve()
      const channels = (store as any).default_sales_channel_id
        ? [{ id: (store as any).default_sales_channel_id }]
        : []
      return channels
    },
    staleTime: 5 * 60 * 1000,
  })
}

export type CreateProductFromMediaPayload = {
  title: string
  mediaFiles: Array<{ id: string; url: string }>
  folderId: string
}

export const useCreateProductFromMedia = () => {
  return useMutation({
    mutationFn: async ({ title, mediaFiles, folderId }: CreateProductFromMediaPayload) => {
      // Fetch store for sales channel
      const { store } = await sdk.admin.store.retrieve()
      const salesChannelId = (store as any).default_sales_channel_id

      const thumbnail = mediaFiles[0]?.url
      const images = mediaFiles.map((f) => ({ url: f.url }))

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
        variants: [
          {
            title: "Default",
            manage_inventory: false,
            prices: [],
          },
        ],
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

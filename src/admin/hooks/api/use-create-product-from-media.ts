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

export type CreateProductFromMediaPayload = {
  title: string
  mediaFiles: Array<{ id: string; url: string }>
  folderId: string
}

export const useCreateProductFromMedia = () => {
  return useMutation({
    mutationFn: async ({ title, mediaFiles, folderId }: CreateProductFromMediaPayload) => {
      // Resolve sales channel — use first active channel
      const { sales_channels } = await sdk.admin.salesChannel.list({
        limit: 10,
        fields: "id,is_disabled",
      })
      const activeChannel = sales_channels?.find((sc: any) => !sc.is_disabled) ?? sales_channels?.[0]
      const salesChannelId = activeChannel?.id

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

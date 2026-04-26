import { useMutation, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../../lib/config"
import { FetchError } from "@medusajs/js-sdk"
import { inventoryItemsRawMaterialQueryKeys } from "./raw-materials"

interface BulkImportItem {
  name: string
  description?: string
  composition?: string
  color?: string
  unit_of_measure?: string
  media?: string[]
  material_type?: string
}

interface BulkImportPayload {
  items: BulkImportItem[]
  stock_location_id?: string
}

interface BulkImportResult {
  message: string
  created: any[]
  errors: { index: number; name: string; error: string }[]
}

export const useBulkImportInventory = () => {
  const queryClient = useQueryClient()

  return useMutation<BulkImportResult, FetchError, BulkImportPayload>({
    mutationFn: async (payload) => {
      const response = await sdk.client.fetch<BulkImportResult>(
        `/admin/inventory-items/bulk-import`,
        {
          method: "POST",
          body: payload,
        }
      )
      return response
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: inventoryItemsRawMaterialQueryKeys.list(),
      })
      queryClient.invalidateQueries({
        queryKey: ["raw-materials"],
      })
    },
  })
}

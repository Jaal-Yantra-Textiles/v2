import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { sdk } from "../../lib/config"

export type ArtisanProposal = {
  is_artisan: boolean
  status: string | null
  partner_id: string | null
  can_approve: boolean
  can_reject: boolean
}

export type ArtisanApprovalResult = {
  id: string
  status: "published" | "rejected"
  partner_id: string | null
  event: string
  rejection_reason?: string | null
}

const proposalKey = (productId: string) =>
  ["artisan-proposal", productId] as const

export const useArtisanProposal = (productId: string) =>
  useQuery({
    queryKey: proposalKey(productId),
    enabled: !!productId,
    queryFn: () =>
      sdk.client.fetch<ArtisanProposal>(
        `/admin/partners/products/${productId}/proposal`,
        { method: "GET" }
      ),
  })

const invalidateProduct = (queryClient: ReturnType<typeof useQueryClient>, productId: string) => {
  // Refresh our proposal state and the core product detail (status changed).
  queryClient.invalidateQueries({ queryKey: proposalKey(productId) })
  queryClient.invalidateQueries({ queryKey: ["products", productId] })
  queryClient.invalidateQueries({ queryKey: ["product", productId] })
}

export const useApproveArtisanProduct = (productId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      sdk.client.fetch<ArtisanApprovalResult>(
        `/admin/partners/products/${productId}/approve`,
        { method: "POST" }
      ),
    onSuccess: () => invalidateProduct(queryClient, productId),
  })
}

export const useRejectArtisanProduct = (productId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    // Optional free-text reason travels to the artisan via the rejection email.
    mutationFn: (reason?: string) =>
      sdk.client.fetch<ArtisanApprovalResult>(
        `/admin/partners/products/${productId}/reject`,
        {
          method: "POST",
          body: reason && reason.trim() ? { rejection_reason: reason.trim() } : {},
        }
      ),
    onSuccess: () => invalidateProduct(queryClient, productId),
  })
}

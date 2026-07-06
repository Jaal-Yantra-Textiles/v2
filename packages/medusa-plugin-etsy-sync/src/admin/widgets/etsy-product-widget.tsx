import { defineWidgetConfig } from "@medusajs/admin-sdk"
import {
  Button,
  Container,
  Heading,
  Text,
  Alert,
  StatusBadge,
  Tooltip,
} from "@medusajs/ui"
import { DetailWidgetProps, AdminProduct } from "@medusajs/framework/types"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { etsyApi } from "../lib/api"

const badgeColor = (status?: string): "green" | "red" | "orange" | "grey" => {
  switch (status) {
    case "synced":
    case "success":
      return "green"
    case "failed":
      return "red"
    case "draft":
    case "pending":
      return "orange"
    default:
      return "grey"
  }
}

const EtsyProductWidget = ({ data }: DetailWidgetProps<AdminProduct>) => {
  const queryClient = useQueryClient()
  const productKey = ["etsy", "product-status", data.id]

  // Global connection + publish-readiness (shared across products).
  const statusQuery = useQuery({
    queryKey: ["etsy", "status"],
    queryFn: () => etsyApi.status() as Promise<any>,
  })
  const connected = !!statusQuery.data?.connected
  const readiness = statusQuery.data?.readiness

  // Persisted per-product sync state — survives navigating away and back, and
  // reflects the live listing state (draft → active) rather than in-memory only.
  const productStatusQuery = useQuery({
    queryKey: productKey,
    queryFn: () => etsyApi.productStatus(data.id),
    // While a listing is still settling (draft / pending), poll so a
    // draft→active transition shows up without a manual refresh.
    refetchInterval: (query) => {
      const s = (query.state.data as any)?.latest?.status
      return s === "draft" || s === "pending" ? 10_000 : false
    },
  })
  const latest = productStatusQuery.data?.latest

  const syncMutation = useMutation({
    mutationFn: () => etsyApi.syncProduct(data.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productKey })
    },
  })
  const result: any = syncMutation.data ? (syncMutation.data as any).result : null
  const error = syncMutation.error
    ? (syncMutation.error as any).message || "Sync failed"
    : null

  // Prefer the just-synced result; otherwise the persisted latest record.
  const view = result
    ? {
        published: result.published,
        state: result.state,
        listing_url: result.listing_url,
        listing_id: result.listing_id,
        warnings: result.warnings as string[] | undefined,
        status: result.published ? "success" : result.state,
      }
    : latest
      ? {
          published: latest.published,
          state: latest.listing_state,
          listing_url: latest.listing_url,
          listing_id: latest.listing_id,
          warnings: latest.error_message
            ? String(latest.error_message).split(" | ")
            : undefined,
          status: latest.status,
        }
      : null

  const notReady = connected && readiness && !readiness.ready_to_publish

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex flex-col gap-1">
          <Heading level="h2">Etsy Sync</Heading>
          <Text className="text-ui-fg-subtle">
            Sync this product to your Etsy shop.
          </Text>
        </div>
        {view && (
          <StatusBadge color={badgeColor(view.status)}>
            {view.published ? "Active" : view.state || view.status}
          </StatusBadge>
        )}
      </div>

      <div className="flex flex-col gap-4 px-6 py-4">
        {!connected && !statusQuery.isLoading && (
          <Alert variant="warning">
            <Text className="text-ui-fg-subtle">
              Etsy is not connected. Connect it under Settings → Etsy.
            </Text>
          </Alert>
        )}

        {notReady && (
          <Alert variant="warning">
            <Text className="text-ui-fg-subtle">
              Publish readiness incomplete (shipping profile, return policy,
              processing profile or default category is missing). Syncing will
              still run and create the listing as a draft.
            </Text>
          </Alert>
        )}

        {error && (
          <Alert variant="error">
            <Text className="text-ui-fg-subtle">{error}</Text>
          </Alert>
        )}

        {view && (
          <Alert variant={view.published ? "success" : "warning"}>
            <div className="flex flex-col gap-1">
              <Text>
                {view.published
                  ? "Published to Etsy as active."
                  : `Synced as ${view.state || view.status}.`}
              </Text>
              {view.warnings && view.warnings.length > 0 && (
                <Text className="text-ui-fg-subtle">
                  {view.warnings.join(" | ")}
                </Text>
              )}
              {view.listing_url && (
                <a
                  href={view.listing_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover"
                >
                  {view.published ? "View on Etsy →" : "Open draft in Etsy →"}
                </a>
              )}
            </div>
          </Alert>
        )}

        <div className="flex items-center gap-3">
          <Tooltip
            content={
              connected
                ? undefined
                : "Connect Etsy under Settings → Etsy first."
            }
          >
            <Button
              size="small"
              isLoading={syncMutation.isPending}
              disabled={!connected}
              onClick={() => syncMutation.mutate()}
            >
              {view ? "Re-sync to Etsy" : "Sync to Etsy"}
            </Button>
          </Tooltip>
        </div>
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.side.before",
})

export default EtsyProductWidget

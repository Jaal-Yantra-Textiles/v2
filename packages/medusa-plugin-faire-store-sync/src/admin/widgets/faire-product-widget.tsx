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
import { faireApi } from "../lib/api"

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

const FaireProductWidget = ({ data }: DetailWidgetProps<AdminProduct>) => {
  const queryClient = useQueryClient()
  const productKey = ["faire", "product-status", data.id]

  const statusQuery = useQuery({
    queryKey: ["faire", "status"],
    queryFn: () => faireApi.status() as Promise<any>,
  })
  const connected = !!statusQuery.data?.connected
  const readiness = statusQuery.data?.readiness

  const productStatusQuery = useQuery({
    queryKey: productKey,
    queryFn: () => faireApi.productStatus(data.id),
    refetchInterval: (query) => {
      const s = (query.state.data as any)?.latest?.status
      return s === "draft" || s === "pending" ? 10_000 : false
    },
  })
  const latest = productStatusQuery.data?.latest

  const syncMutation = useMutation({
    mutationFn: () => faireApi.syncProduct(data.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productKey })
    },
  })
  const result: any = syncMutation.data ? (syncMutation.data as any).result : null
  const error = syncMutation.error
    ? (syncMutation.error as any).message || "Sync failed"
    : null

  const view = result
    ? {
        published: result.published,
        state: result.state,
        product_url: result.product_url,
        product_token: result.product_token,
        warnings: result.warnings as string[] | undefined,
        status: result.published ? "success" : result.state,
      }
    : latest
      ? {
          published: latest.published,
          state: latest.product_state,
          product_url: latest.product_url,
          product_token: latest.product_token,
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
          <Heading level="h2">Faire Sync</Heading>
          <Text className="text-ui-fg-subtle">
            Sync this product to your Faire brand.
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
              Faire is not connected. Connect it under Settings → Faire.
            </Text>
          </Alert>
        )}

        {notReady && (
          <Alert variant="warning">
            <Text className="text-ui-fg-subtle">
              Publish readiness incomplete (brand or wholesale pricing config is
              missing). Syncing will still run and create the product as a draft.
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
                  ? "Published to Faire as active."
                  : `Synced as ${view.state || view.status}.`}
              </Text>
              {view.warnings && view.warnings.length > 0 && (
                <Text className="text-ui-fg-subtle">
                  {view.warnings.join(" | ")}
                </Text>
              )}
              {view.product_url && (
                <a
                  href={view.product_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover"
                >
                  {view.published ? "View on Faire →" : "Open in Faire →"}
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
                : "Connect Faire under Settings → Faire first."
            }
          >
            <Button
              size="small"
              isLoading={syncMutation.isPending}
              disabled={!connected}
              onClick={() => syncMutation.mutate()}
            >
              {view ? "Re-sync to Faire" : "Sync to Faire"}
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

export default FaireProductWidget

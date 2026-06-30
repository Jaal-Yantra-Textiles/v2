import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Button, Container, Heading, Text, Alert, StatusBadge } from "@medusajs/ui"
import { DetailWidgetProps, AdminProduct } from "@medusajs/framework/types"
import { useCallback, useState } from "react"
import { etsyApi } from "../lib/api"

const statusColor = (status: string): "green" | "red" | "orange" | "grey" => {
  switch (status) {
    case "synced":
    case "success":
      return "green"
    case "failed":
      return "red"
    case "pending":
      return "orange"
    default:
      return "grey"
  }
}

const EtsyProductWidget = ({ data }: DetailWidgetProps<AdminProduct>) => {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSync = useCallback(async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res: any = await etsyApi.syncProduct(data.id)
      setResult(res.result)
    } catch (err: any) {
      setError(err.message || "Sync failed")
    } finally {
      setLoading(false)
    }
  }, [data.id])

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex flex-col gap-1">
          <Heading level="h2">Etsy Sync</Heading>
          <Text className="text-ui-fg-subtle">Sync this product to your Etsy shop.</Text>
        </div>
      </div>

      <div className="flex flex-col gap-4 px-6 py-4">
        {error && (
          <Alert variant="error">
            <Text className="text-ui-fg-subtle">{error}</Text>
          </Alert>
        )}

        {result && (
          <Alert variant={result.published ? "success" : "warning"}>
            <div className="flex flex-col gap-1">
              <Text>
                {result.published
                  ? "Published to Etsy as active."
                  : `Synced as ${result.state}.`}
              </Text>
              {result.warnings?.length > 0 && (
                <Text className="text-ui-fg-subtle">
                  {result.warnings.join(" | ")}
                </Text>
              )}
              {result.listing_url && (
                <a
                  href={result.listing_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover"
                >
                  View on Etsy →
                </a>
              )}
            </div>
          </Alert>
        )}

        <div className="flex items-center gap-3">
          <Button size="small" isLoading={loading} onClick={handleSync}>
            {loading ? "Syncing…" : "Sync to Etsy"}
          </Button>
          {result?.listing_id && (
            <StatusBadge color={result.published ? "green" : "grey"}>
              {result.published ? "Active" : result.state}
            </StatusBadge>
          )}
        </div>
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.side.before",
})

export default EtsyProductWidget

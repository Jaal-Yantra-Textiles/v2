import {
  Button,
  Container,
  Heading,
  Label,
  StatusBadge,
  Text,
  Toaster,
} from "@medusajs/ui"
import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { etsyApi } from "../../../../lib/api"
import type { EtsySyncRecord } from "../hooks/use-etsy-sync-columns"

const STATUS_COLORS: Record<string, "green" | "red" | "orange" | "grey"> = {
  success: "green",
  failed: "red",
  draft: "orange",
  pending: "grey",
  syncing: "grey",
}

const EtsySyncDetailPage = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [record, setRecord] = useState<EtsySyncRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    etsyApi
      .getSync(id)
      .then((res: any) => {
        setRecord(res.sync || res)
      })
      .catch((err: any) => setError(err.message || "Failed to load sync record"))
      .finally(() => setLoading(false))
  }, [id])

  const handleRetry = async () => {
    if (!record) return
    setRetrying(true)
    try {
      await etsyApi.retrySync(record.id)
      navigate("/settings/etsy", { replace: true })
    } catch (err: any) {
      setError(err.message || "Retry failed")
    } finally {
      setRetrying(false)
    }
  }

  if (loading) {
    return (
      <Container className="p-6">
        <Text>Loading…</Text>
      </Container>
    )
  }

  if (!record) {
    return (
      <Container className="p-6 flex flex-col gap-4">
        <Heading level="h1">Sync record not found</Heading>
        <Button size="small" variant="secondary" onClick={() => navigate("/settings/etsy")}>
          Back to Etsy settings
        </Button>
      </Container>
    )
  }

  const warnings: string[] = record.error_message
    ? record.error_message.split(" | ")
    : []

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Container className="p-4">
          <Text className="text-ui-tag-red-text">{error}</Text>
        </Container>
      )}

      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex flex-col gap-1">
            <Heading level="h1">Sync record</Heading>
            <Text className="text-ui-fg-subtle font-mono text-xs">{record.id}</Text>
          </div>
          <StatusBadge color={STATUS_COLORS[record.status] || "grey"}>
            {record.status}
          </StatusBadge>
        </div>

        <div className="px-6 py-4 grid grid-cols-2 gap-4">
          <Detail label="Product" value={record.product_id} mono />
          <Detail label="Action" value={record.action} />
          <Detail label="Listing ID" value={record.listing_id || "—"} mono />
          <Detail label="Listing state" value={record.listing_state || "—"} />
          <Detail label="Published" value={record.published ? "Yes" : "No"} />
          <Detail
            label="Synced at"
            value={record.synced_at ? new Date(record.synced_at).toLocaleString() : "—"}
          />
        </div>

        {record.listing_url && (
          <div className="px-6 py-4">
            <Button
              size="small"
              variant="secondary"
              onClick={() => window.open(record.listing_url!, "_blank")}
            >
              View on Etsy
            </Button>
          </div>
        )}
      </Container>

      {warnings.length > 0 && (
        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Issues</Heading>
          </div>
          <div className="px-6 py-4 flex flex-col gap-2">
            {warnings.map((w, i) => (
              <Text key={i} className="text-ui-tag-red-text text-sm">
                {w}
              </Text>
            ))}
          </div>
        </Container>
      )}

      <div className="flex items-center gap-2">
        <Button size="small" variant="secondary" onClick={() => navigate("/settings/etsy")}>
          Back
        </Button>
        <Button size="small" isLoading={retrying} onClick={handleRetry}>
          Re-sync product
        </Button>
      </div>

      <Toaster />
    </div>
  )
}

const Detail = ({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) => (
  <div className="flex flex-col gap-1">
    <Label>{label}</Label>
    <Text className={mono ? "font-mono text-xs" : ""}>{value}</Text>
  </div>
)

export const handle = {
  breadcrumb: () => "Sync record",
}

export default EtsySyncDetailPage

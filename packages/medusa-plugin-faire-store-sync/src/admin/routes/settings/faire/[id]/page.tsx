import {
  Button,
  Container,
  DropdownMenu,
  Heading,
  IconButton,
  Label,
  Skeleton,
  StatusBadge,
  Text,
  Toaster,
} from "@medusajs/ui"
import { EllipsisHorizontal, ArrowPath, ArrowUpRightOnBox } from "@medusajs/icons"
import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { faireApi } from "../../../../lib/api"
import type { FaireSyncRecord } from "../hooks/use-faire-sync-columns"

const STATUS_COLORS: Record<string, "green" | "red" | "orange" | "grey"> = {
  success: "green",
  failed: "red",
  draft: "orange",
  pending: "grey",
  syncing: "grey",
}

const FaireSyncDetailPage = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [record, setRecord] = useState<FaireSyncRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    faireApi
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
    setError(null)
    try {
      await faireApi.retrySync(record.id)
      const updated = await faireApi.getSync(record.id).catch(() => null)
      if (updated) setRecord((updated as any).sync || updated)
    } catch (err: any) {
      setError(err.message || "Retry failed")
    } finally {
      setRetrying(false)
    }
  }

  if (loading) {
    return (
      <Container className="p-6">
        <Skeleton className="h-7 w-12 rounded-md" />
      </Container>
    )
  }

  if (!record) {
    return (
      <Container className="p-6 flex flex-col gap-4">
        <Heading level="h1">Sync record not found</Heading>
        <Button size="small" variant="secondary" onClick={() => navigate("/settings/faire")}>
          Back to Faire settings
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
          <div className="flex items-center gap-3">
            <StatusBadge color={STATUS_COLORS[record.status] || "grey"}>
              {record.status}
            </StatusBadge>
            <DropdownMenu>
              <DropdownMenu.Trigger asChild>
                <IconButton size="small" variant="transparent" disabled={retrying}>
                  <EllipsisHorizontal />
                </IconButton>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end">
                <DropdownMenu.Item
                  className="gap-x-2"
                  onClick={handleRetry}
                  disabled={retrying}
                >
                  <ArrowPath className="text-ui-fg-subtle" />
                  {retrying ? "Re-syncing…" : "Re-sync product"}
                </DropdownMenu.Item>
                {record.product_url && (
                  <DropdownMenu.Item
                    className="gap-x-2"
                    onClick={() => window.open(record.product_url!, "_blank")}
                  >
                    <ArrowUpRightOnBox className="text-ui-fg-subtle" />
                    Open on Faire
                  </DropdownMenu.Item>
                )}
              </DropdownMenu.Content>
            </DropdownMenu>
          </div>
        </div>

        <div className="px-6 py-4 grid grid-cols-2 gap-4">
          <Detail label="Product" value={record.product_id} mono />
          <Detail label="Action" value={record.action} />
          <Detail label="Faire product token" value={record.product_token || "—"} mono />
          <Detail label="State" value={record.product_state || "—"} />
          <Detail label="Published" value={record.published ? "Yes" : "No"} />
          <Detail
            label="Synced at"
            value={record.synced_at ? new Date(record.synced_at).toLocaleString() : "—"}
          />
        </div>
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

export default FaireSyncDetailPage

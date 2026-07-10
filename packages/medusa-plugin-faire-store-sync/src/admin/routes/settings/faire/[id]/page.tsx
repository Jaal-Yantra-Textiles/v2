import {
  Button,
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
import { RouteFocusModal } from "../../../../components/route-focus-modal"
import type { FaireSyncRecord } from "../hooks/use-faire-sync-columns"

const PARENT = "/settings/faire"

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

  const warnings: string[] = record?.error_message
    ? record.error_message.split(" | ")
    : []

  return (
    <RouteFocusModal prev={PARENT}>
      <RouteFocusModal.Header>
        <div className="flex items-center gap-3">
          <Heading level="h1">Sync record</Heading>
          {record && (
            <StatusBadge color={STATUS_COLORS[record.status] || "grey"}>
              {record.status}
            </StatusBadge>
          )}
        </div>
        {record && (
          <div className="flex items-center gap-2">
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
        )}
      </RouteFocusModal.Header>

      <RouteFocusModal.Body className="flex flex-col gap-4 overflow-y-auto p-6">
        {error && <Text className="text-ui-tag-red-text">{error}</Text>}

        {loading ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : !record ? (
          <div className="flex flex-col items-start gap-4">
            <Heading level="h2">Sync record not found</Heading>
            <Button size="small" variant="secondary" onClick={() => navigate(PARENT)}>
              Back to Faire settings
            </Button>
          </div>
        ) : (
          <>
            <div className="border-ui-border-base grid grid-cols-2 gap-4 rounded-lg border p-4">
              <Detail label="Record id" value={record.id} mono />
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

            {warnings.length > 0 && (
              <div className="border-ui-border-base flex flex-col gap-2 rounded-lg border p-4">
                <Heading level="h2">Issues</Heading>
                {warnings.map((w, i) => (
                  <Text key={i} className="text-ui-tag-red-text text-sm">
                    {w}
                  </Text>
                ))}
              </div>
            )}
          </>
        )}
      </RouteFocusModal.Body>
      <Toaster />
    </RouteFocusModal>
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

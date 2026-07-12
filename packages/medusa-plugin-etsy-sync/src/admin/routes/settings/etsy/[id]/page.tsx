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
  usePrompt,
} from "@medusajs/ui"
import { EllipsisHorizontal, ArrowPath, ArrowUpRightOnBox, Trash } from "@medusajs/icons"
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
  const prompt = usePrompt()
  const [record, setRecord] = useState<EtsySyncRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState(false)
  const [deleting, setDeleting] = useState(false)
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
    setError(null)
    try {
      const res: any = await etsyApi.retrySync(record.id)
      // Reflect the re-synced state in place rather than bouncing back to the list.
      const updated = await etsyApi.getSync(record.id).catch(() => null)
      if (updated) setRecord((updated as any).sync || updated)
      else if (res?.sync) setRecord(res.sync)
    } catch (err: any) {
      setError(err.message || "Retry failed")
    } finally {
      setRetrying(false)
    }
  }

  const handleDelete = async () => {
    if (!record) return
    const confirmed = await prompt({
      title: "Delete from Etsy?",
      description:
        "This removes the listing from Etsy and unlinks it from the product. This can't be undone — you'd have to re-sync to recreate it.",
      confirmText: "Delete",
      cancelText: "Cancel",
    })
    if (!confirmed) return
    setDeleting(true)
    setError(null)
    try {
      await etsyApi.deleteSync(record.id)
      // Reflect the removal in place, then return to the list.
      const updated = await etsyApi.getSync(record.id).catch(() => null)
      if (updated) setRecord((updated as any).sync || updated)
      navigate("/settings/etsy")
    } catch (err: any) {
      setError(err.message || "Delete failed")
    } finally {
      setDeleting(false)
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
          <div className="flex items-center gap-3">
            <StatusBadge color={STATUS_COLORS[record.status] || "grey"}>
              {record.status}
            </StatusBadge>
            <DropdownMenu>
              <DropdownMenu.Trigger asChild>
                <IconButton size="small" variant="transparent" disabled={retrying || deleting}>
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
                {record.listing_url && (
                  <DropdownMenu.Item
                    className="gap-x-2"
                    onClick={() => window.open(record.listing_url!, "_blank")}
                  >
                    <ArrowUpRightOnBox className="text-ui-fg-subtle" />
                    Open on Etsy
                  </DropdownMenu.Item>
                )}
                <DropdownMenu.Separator />
                <DropdownMenu.Item
                  className="gap-x-2 text-ui-fg-error"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  <Trash className="text-ui-fg-error" />
                  {deleting ? "Deleting…" : "Delete from Etsy"}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu>
          </div>
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

export default EtsySyncDetailPage

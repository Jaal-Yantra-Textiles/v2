import { defineWidgetConfig } from "@medusajs/admin-sdk"
import {
  Button,
  Container,
  Drawer,
  Heading,
  Input,
  Label,
  Text,
  Alert,
  Badge,
  StatusBadge,
  Tooltip,
  clx,
  toast,
} from "@medusajs/ui"
import { DetailWidgetProps, AdminProduct } from "@medusajs/framework/types"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { faireApi, sdk } from "../lib/api"

const MAX_RENDERED = 60

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

  // ── Faire category (taxonomy_type) picker ────────────────────────────────
  // Faire requires a category per product. Sync resolves it in this order:
  //   metadata.faire_taxonomy_type_id → metadata.faire_category →
  //   product Type (by name) → account fallback. This panel pins an exact
  //   `tt_…` id in metadata so the mapping is unambiguous.
  const metadata: Record<string, any> = (data as any).metadata || {}
  const productType: string | undefined = (data as any).type?.value

  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerSearch, setPickerSearch] = useState("")
  // Local echo of the saved pin so the panel updates instantly (the parent
  // product page's `data.metadata` only refreshes on its own refetch).
  const [pinnedOverride, setPinnedOverride] = useState<string | null | undefined>(
    undefined
  )

  const taxonomyQuery = useQuery({
    queryKey: ["faire", "taxonomy"],
    enabled: pickerOpen,
    queryFn: async () => (await faireApi.taxonomy()).taxonomy ?? [],
  })
  const taxonomy = taxonomyQuery.data ?? []

  const pinnedId: string | undefined =
    pinnedOverride !== undefined
      ? pinnedOverride ?? undefined
      : metadata.faire_taxonomy_type_id
  const pinnedName = useMemo(() => {
    if (!pinnedId) return undefined
    if (!/^tt_/.test(String(pinnedId))) return String(pinnedId)
    return taxonomy.find((t: any) => t.id === pinnedId)?.name
  }, [pinnedId, taxonomy])

  // What the sync will actually use as the category source, for display.
  const resolvedSource = pinnedId
    ? { label: pinnedName || String(pinnedId), from: "pinned" as const }
    : metadata.faire_category
      ? { label: String(metadata.faire_category), from: "metadata" as const }
      : productType
        ? { label: productType, from: "type" as const }
        : { label: "Account fallback", from: "fallback" as const }

  const filteredTaxonomy = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase()
    const list = q
      ? taxonomy.filter((t: any) => t.name.toLowerCase().includes(q))
      : taxonomy
    return list.slice(0, MAX_RENDERED)
  }, [taxonomy, pickerSearch])

  const saveCategory = useMutation({
    mutationFn: (value: string | null) =>
      sdk.admin.product.update(data.id, {
        metadata: { ...metadata, faire_taxonomy_type_id: value },
      }),
    onSuccess: (_res, value) => {
      setPinnedOverride(value)
      queryClient.invalidateQueries({ queryKey: ["product", data.id] })
      setPickerOpen(false)
      setPickerSearch("")
      toast.success(value ? "Faire category set" : "Faire category cleared")
    },
    onError: (err: any) =>
      toast.error("Failed to save category", { description: err?.message }),
  })

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

        {/* Faire category (taxonomy_type) */}
        <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <Text size="small" weight="plus">
                Faire category
              </Text>
              <Badge size="2xsmall" color={resolvedSource.from === "fallback" ? "orange" : "grey"}>
                {resolvedSource.from === "pinned"
                  ? "Pinned"
                  : resolvedSource.from === "type"
                    ? "From Type"
                    : resolvedSource.from === "metadata"
                      ? "Metadata"
                      : "Fallback"}
              </Badge>
            </div>
            <Text size="small" className="text-ui-fg-subtle">
              {resolvedSource.label}
            </Text>
          </div>
          <Button
            size="small"
            variant="secondary"
            disabled={!connected}
            onClick={() => setPickerOpen(true)}
          >
            {pinnedId ? "Change" : "Set category"}
          </Button>
        </div>

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

      {/* Category picker — searchable list from Faire's taxonomy API. */}
      <Drawer open={pickerOpen} onOpenChange={setPickerOpen}>
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>Pick a Faire category</Drawer.Title>
            <Drawer.Description>
              Search Faire's product taxonomy and pin an exact category to this
              product.
            </Drawer.Description>
          </Drawer.Header>
          <Drawer.Body className="flex flex-col gap-3 overflow-hidden">
            <Input
              type="search"
              autoFocus
              placeholder="Search categories…"
              value={pickerSearch}
              onChange={(e) => setPickerSearch(e.target.value)}
            />
            <div className="flex flex-col gap-1 overflow-y-auto">
              {taxonomyQuery.isLoading ? (
                <Text size="small" className="text-ui-fg-subtle px-1 py-2">
                  Loading categories…
                </Text>
              ) : filteredTaxonomy.length === 0 ? (
                <Text size="small" className="text-ui-fg-subtle px-1 py-2">
                  No categories match “{pickerSearch}”.
                </Text>
              ) : (
                filteredTaxonomy.map((t: any) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => saveCategory.mutate(t.id)}
                    disabled={saveCategory.isPending}
                    className={clx(
                      "flex items-center justify-between rounded-md px-3 py-2 text-left text-sm",
                      "hover:bg-ui-bg-base-hover",
                      t.id === pinnedId && "bg-ui-bg-highlight"
                    )}
                  >
                    <span>{t.name}</span>
                    {t.id === pinnedId && (
                      <Badge size="2xsmall" color="green">
                        Current
                      </Badge>
                    )}
                  </button>
                ))
              )}
              {!taxonomyQuery.isLoading &&
                taxonomy.length > filteredTaxonomy.length && (
                  <Text size="xsmall" className="text-ui-fg-muted px-1 py-1">
                    Showing {filteredTaxonomy.length} of {taxonomy.length} — refine
                    your search to narrow down.
                  </Text>
                )}
            </div>
          </Drawer.Body>
          <Drawer.Footer>
            {pinnedId && (
              <Button
                variant="secondary"
                onClick={() => saveCategory.mutate(null)}
                isLoading={saveCategory.isPending}
              >
                Clear
              </Button>
            )}
            <Drawer.Close asChild>
              <Button variant="secondary">Cancel</Button>
            </Drawer.Close>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.side.before",
})

export default FaireProductWidget

import {
  Badge,
  Button,
  Checkbox,
  Heading,
  StatusBadge,
  Text,
  toast,
  clx,
} from "@medusajs/ui"
import { useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { RouteFocusModal } from "../modal/route-focus-modal"
import {
  usePreviewGoogleMerchantImport,
  useCommitGoogleMerchantImport,
  type GoogleMerchantPreviewItem,
  type GoogleMerchantCommitMapping,
} from "../../hooks/api/google-merchant"
import { ProductPicker } from "./product-picker"

type RowSelection = {
  included: boolean
  productId: string | null
  productHandle: string | null
}

const matchReasonLabel = (
  reason: GoogleMerchantPreviewItem["suggested_match_reason"]
): string => {
  switch (reason) {
    case "handle":
      return "Matched by handle"
    case "sku":
      return "Matched by SKU"
    case "normalized_handle":
      return "Fuzzy handle match"
    case "normalized_sku":
      return "Fuzzy SKU match"
    default:
      return ""
  }
}

export const ImportGoogleMerchantProducts = () => {
  const { id } = useParams<{ id: string }>()
  const accountId = id as string
  const navigate = useNavigate()

  const preview = usePreviewGoogleMerchantImport(accountId)
  const commit = useCommitGoogleMerchantImport(accountId)

  const [rows, setRows] = useState<Record<string, RowSelection>>({})
  const [previewResult, setPreviewResult] = useState<
    Awaited<ReturnType<typeof preview.mutateAsync>> | null
  >(null)

  // Fire the preview once on mount.
  useEffect(() => {
    if (!accountId) return
    preview
      .mutateAsync()
      .then((result) => {
        setPreviewResult(result)
        const initial: Record<string, RowSelection> = {}
        for (const item of result.items) {
          initial[item.offer_id] = {
            included: !!item.suggested_product_id && !item.existing_link,
            productId: item.suggested_product_id,
            productHandle: item.suggested_product_handle,
          }
        }
        setRows(initial)
      })
      .catch((e: any) => {
        toast.error(e?.message || "Failed to load Google products")
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

  const items = previewResult?.items || []

  const stats = useMemo(() => {
    let selected = 0
    let withSuggestion = 0
    let externallyManaged = 0
    let alreadyLinked = 0
    for (const item of items) {
      if (item.suggested_product_id) withSuggestion++
      if (item.is_externally_managed) externallyManaged++
      if (item.existing_link) alreadyLinked++
      const row = rows[item.offer_id]
      if (row?.included && row.productId) selected++
    }
    return { selected, withSuggestion, externallyManaged, alreadyLinked }
  }, [items, rows])

  const setRow = (offerId: string, patch: Partial<RowSelection>) =>
    setRows((prev) => ({
      ...prev,
      [offerId]: {
        included: prev[offerId]?.included ?? false,
        productId: prev[offerId]?.productId ?? null,
        productHandle: prev[offerId]?.productHandle ?? null,
        ...patch,
      },
    }))

  const selectAllWithSuggestions = () => {
    setRows((prev) => {
      const next = { ...prev }
      for (const item of items) {
        if (item.suggested_product_id) {
          next[item.offer_id] = {
            included: true,
            productId: item.suggested_product_id,
            productHandle: item.suggested_product_handle,
          }
        }
      }
      return next
    })
  }

  const clearSelection = () => {
    setRows((prev) => {
      const next = { ...prev }
      for (const key of Object.keys(next)) {
        next[key] = { ...next[key], included: false }
      }
      return next
    })
  }

  const handleCommit = async () => {
    if (!previewResult) return
    const mappings: GoogleMerchantCommitMapping[] = []
    for (const item of items) {
      const row = rows[item.offer_id]
      if (!row?.included || !row.productId) continue
      mappings.push({
        offer_id: item.offer_id,
        product_id: row.productId,
        google_name: item.google_name,
        source_data_source: item.data_source,
      })
    }
    if (mappings.length === 0) {
      toast.error("Select at least one product to link")
      return
    }
    try {
      const r = await commit.mutateAsync({ mappings })
      const parts = [`${r.linked} linked`, `${r.refreshed} refreshed`]
      if (r.errors.length) parts.push(`${r.errors.length} errors`)
      toast.success(parts.join(" · "))
      navigate(`/settings/google-merchant/${accountId}`, { replace: true })
    } catch (e: any) {
      toast.error(e?.message || "Failed to commit import")
    }
  }

  const isLoading = preview.isPending && !previewResult

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <RouteFocusModal.Header>
        <div className="flex items-center justify-end gap-x-2">
          <RouteFocusModal.Close asChild>
            <Button size="small" variant="secondary">
              Cancel
            </Button>
          </RouteFocusModal.Close>
          <Button
            size="small"
            variant="primary"
            onClick={handleCommit}
            isLoading={commit.isPending}
            disabled={isLoading || stats.selected === 0}
          >
            Link {stats.selected > 0 ? stats.selected : ""} product
            {stats.selected === 1 ? "" : "s"}
          </Button>
        </div>
      </RouteFocusModal.Header>

      <RouteFocusModal.Body className="flex flex-1 flex-col overflow-hidden px-0">
        <div className="flex items-start justify-between gap-x-4 border-b px-6 py-5">
          <div>
            <Heading className="text-xl">Import from Google Merchant</Heading>
            <Text size="small" className="text-ui-fg-subtle mt-1">
              Review Google Merchant Center listings and match them to Medusa
              products before linking. Auto-matched rows are pre-selected — override
              or leave the rest for a later pass.
            </Text>
          </div>
          {previewResult && (
            <div className="flex flex-col items-end gap-y-1">
              <Text size="xsmall" className="text-ui-fg-subtle">
                {previewResult.google_total} on Google · {stats.withSuggestion} auto-matched
              </Text>
              <Text size="xsmall" className="text-ui-fg-subtle">
                {stats.alreadyLinked} already linked · {stats.externallyManaged} externally managed
              </Text>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-b bg-ui-bg-subtle px-6 py-3">
          <div className="flex items-center gap-x-2">
            <Button
              size="small"
              variant="secondary"
              onClick={selectAllWithSuggestions}
              disabled={isLoading || stats.withSuggestion === 0}
            >
              Select auto-matched
            </Button>
            <Button
              size="small"
              variant="transparent"
              onClick={clearSelection}
              disabled={isLoading || stats.selected === 0}
            >
              Clear selection
            </Button>
          </div>
          <Text size="xsmall" className="text-ui-fg-subtle">
            {stats.selected} selected
          </Text>
        </div>

        <div className="flex-1 overflow-auto">
          {isLoading && (
            <div className="px-6 py-10 text-center">
              <Text className="text-ui-fg-subtle">Fetching products from Google…</Text>
            </div>
          )}
          {!isLoading && items.length === 0 && previewResult && (
            <div className="px-6 py-10 text-center">
              <Text className="text-ui-fg-subtle">
                No products found in this Merchant Center account.
              </Text>
            </div>
          )}
          {!isLoading && items.length > 0 && (
            <table className="w-full text-left">
              <thead className="sticky top-0 z-10 border-b bg-ui-bg-base">
                <tr>
                  <th className="w-8 px-4 py-2" />
                  <th className="px-2 py-2">
                    <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
                      Google product
                    </Text>
                  </th>
                  <th className="px-2 py-2">
                    <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
                      Source
                    </Text>
                  </th>
                  <th className="px-2 py-2">
                    <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
                      Matched Medusa product
                    </Text>
                  </th>
                  <th className="px-2 py-2">
                    <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
                      Status
                    </Text>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const row = rows[item.offer_id] || {
                    included: false,
                    productId: null,
                    productHandle: null,
                  }
                  return (
                    <tr
                      key={item.offer_id}
                      className={clx(
                        "border-b",
                        row.included ? "bg-ui-bg-highlight" : "bg-ui-bg-base"
                      )}
                    >
                      <td className="w-8 px-4 py-2 align-top">
                        <Checkbox
                          checked={row.included}
                          onCheckedChange={(c) =>
                            setRow(item.offer_id, { included: !!c })
                          }
                          disabled={!row.productId}
                        />
                      </td>
                      <td className="px-2 py-2 align-top">
                        <div className="flex flex-col gap-y-0.5 max-w-[280px]">
                          <Text size="small" weight="plus" className="truncate">
                            {item.google_name}
                          </Text>
                          <Text size="xsmall" className="text-ui-fg-subtle truncate">
                            offer: {item.offer_id}
                          </Text>
                          {(item.feed_label || item.content_language) && (
                            <Text size="xsmall" className="text-ui-fg-muted">
                              {[item.feed_label, item.content_language]
                                .filter(Boolean)
                                .join(" · ")}
                            </Text>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-2 align-top">
                        {item.is_externally_managed ? (
                          <Badge color="orange" size="2xsmall">External</Badge>
                        ) : item.data_source ? (
                          <Badge color="green" size="2xsmall">Ours</Badge>
                        ) : (
                          <Badge color="grey" size="2xsmall">Unknown</Badge>
                        )}
                      </td>
                      <td className="px-2 py-2 align-top">
                        <div className="flex flex-col gap-y-1">
                          <ProductPicker
                            value={
                              row.productId
                                ? { id: row.productId, handle: row.productHandle }
                                : null
                            }
                            onChange={(v) =>
                              setRow(item.offer_id, {
                                productId: v?.id || null,
                                productHandle: v?.handle || null,
                                included: v ? row.included : false,
                              })
                            }
                            placeholder="Pick a Medusa product…"
                          />
                          {item.suggested_match_reason && (
                            <Text size="xsmall" className="text-ui-fg-subtle">
                              {matchReasonLabel(item.suggested_match_reason)}
                            </Text>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-2 align-top">
                        {item.existing_link ? (
                          <StatusBadge
                            color={item.existing_link.is_same_source ? "blue" : "orange"}
                          >
                            {item.existing_link.is_same_source
                              ? "Will refresh"
                              : "Has other link"}
                          </StatusBadge>
                        ) : row.productId ? (
                          <StatusBadge color="green">Ready</StatusBadge>
                        ) : (
                          <StatusBadge color="grey">Unmatched</StatusBadge>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </RouteFocusModal.Body>
    </div>
  )
}

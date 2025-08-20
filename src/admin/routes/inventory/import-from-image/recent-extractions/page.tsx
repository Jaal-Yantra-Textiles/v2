import { Button, Text } from "@medusajs/ui"
import React from "react"
import { StackedFocusModal } from "../../../../components/modal/stacked-modal/stacked-focused-modal"
import { sdk } from "../../../../lib/config"

interface RecentExtractionsModalProps {
  onLoad: (extraction: any) => void
  resourceId?: string
}

const RecentExtractionsModal = ({ onLoad, resourceId = "image-extraction:inventory-extraction" }: RecentExtractionsModalProps) => {
  const [items, setItems] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState<boolean>(false)

  const fetchRecent = React.useCallback(async () => {
    setLoading(true)
    try {
      const resource = encodeURIComponent(resourceId)
      const resp = await sdk.client.fetch(`/admin/ai/image-extraction/recent?resource=${resource}`, { method: "GET" })
      const data: any = resp || {}
      setItems(Array.isArray(data.items) ? data.items : [])
    } catch (e) {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [resourceId])

  return (
    <StackedFocusModal id="recent-extractions-modal">
      <StackedFocusModal.Trigger asChild>
        <Button variant="secondary" size="small" type="button" onClick={() => fetchRecent()}>
          Recent extractions
        </Button>
      </StackedFocusModal.Trigger>

      <StackedFocusModal.Content className="flex flex-col">
        <StackedFocusModal.Header>
          <StackedFocusModal.Title>Recent Extractions</StackedFocusModal.Title>
        </StackedFocusModal.Header>

        <div className="p-3">
          <Text size="small" className="text-ui-fg-subtle">Inventory extraction history</Text>
        </div>

        <div className="overflow-x-auto px-3 pb-3">
          {loading ? (
            <Text>Loading…</Text>
          ) : (
            <table className="min-w-full border-separate border-spacing-0">
              <thead>
                <tr className="text-left">
                  <th className="border-b border-ui-border-base pb-2 pr-4">Time</th>
                  <th className="border-b border-ui-border-base pb-2 pr-4">Entity</th>
                  <th className="border-b border-ui-border-base pb-2 pr-4">Items</th>
                  <th className="border-b border-ui-border-base pb-2 pr-4">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-2 pr-4 text-ui-fg-subtle">No recent extractions</td>
                  </tr>
                )}
                {items.map((r, idx) => (
                  <tr key={idx} className="align-top">
                    <td className="py-2 pr-4">{r.timestamp ? new Date(r.timestamp).toLocaleString() : "-"}</td>
                    <td className="py-2 pr-4">{r.entity_type || "-"}</td>
                    <td className="py-2 pr-4">{r.itemsCount ?? (r.result?.items?.length ?? "-")}</td>
                    <td className="py-2 pr-4">
                      <StackedFocusModal.Close asChild>
                        <Button
                          size="small"
                          variant="secondary"
                          type="button"
                          onClick={() => {
                            const maybe = r.result || r.extraction || null
                            if (maybe) onLoad(maybe)
                          }}
                        >
                          Load
                        </Button>
                      </StackedFocusModal.Close>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <StackedFocusModal.Footer>
          <div className="flex w-full items-center justify-end gap-x-2">
            <StackedFocusModal.Close asChild>
              <Button variant="secondary" type="button">Close</Button>
            </StackedFocusModal.Close>
          </div>
        </StackedFocusModal.Footer>
      </StackedFocusModal.Content>
    </StackedFocusModal>
  )
}

export default RecentExtractionsModal

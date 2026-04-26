import {
  Button,
  FocusModal,
  Heading,
  Input,
  Label,
  Select,
  Text,
  toast,
} from "@medusajs/ui"
import { useState } from "react"
import { useExecuteInboundEmailAction } from "../../hooks/api/inbound-emails"
import { useStockLocations } from "../../hooks/api/stock_location"

interface ExecuteActionDialogProps {
  emailId: string
  actionType: string
  extractedData: Record<string, any> | null
  onClose: () => void
}

interface ItemMapping {
  extracted_item_index: number
  inventory_item_id: string
  quantity: number
  price: number
}

export function ExecuteActionDialog({
  emailId,
  actionType,
  extractedData,
  onClose,
}: ExecuteActionDialogProps) {
  const { stock_locations } = useStockLocations({ limit: 100 })
  const [stockLocationId, setStockLocationId] = useState("")
  const [itemMappings, setItemMappings] = useState<ItemMapping[]>(() => {
    const items = (extractedData?.items as any[]) || []
    return items.map((item, i) => ({
      extracted_item_index: i,
      inventory_item_id: "",
      quantity: item.quantity || 1,
      price: item.price || 0,
    }))
  })

  const { mutate: execute, isPending } = useExecuteInboundEmailAction(emailId, {
    onSuccess: () => {
      toast.success("Action executed successfully")
      onClose()
    },
    onError: (err) => toast.error(err.message || "Execution failed"),
  })

  const extractedItems = (extractedData?.items as any[]) || []

  const updateMapping = (index: number, field: keyof ItemMapping, value: any) => {
    setItemMappings((prev) =>
      prev.map((m, i) => (i === index ? { ...m, [field]: value } : m))
    )
  }

  const handleSubmit = () => {
    if (!stockLocationId) {
      toast.error("Please select a stock location")
      return
    }

    const validMappings = itemMappings.filter((m) => m.inventory_item_id)
    if (validMappings.length === 0) {
      toast.error("Please map at least one item to an inventory item")
      return
    }

    execute({
      action_type: actionType,
      params: {
        stock_location_id: stockLocationId,
        item_mappings: validMappings,
      },
    })
  }

  return (
    <FocusModal open onOpenChange={(open) => { if (!open) onClose() }}>
      <FocusModal.Content>
        <FocusModal.Header>
          <div className="flex items-center justify-end gap-x-2">
            <FocusModal.Close asChild>
              <Button size="small" variant="secondary">
                Cancel
              </Button>
            </FocusModal.Close>
            <Button size="small" onClick={handleSubmit} isLoading={isPending}>
              Execute Action
            </Button>
          </div>
        </FocusModal.Header>

        <FocusModal.Body>
          <div className="flex flex-1 flex-col items-center overflow-y-auto">
            <div className="mx-auto flex w-full max-w-[720px] flex-col gap-y-8 px-2 py-16">

              <div>
                <Heading className="capitalize">
                  {actionType.replace(/_/g, " ")}
                </Heading>
                {extractedData && (
                  <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ui-fg-subtle">
                    {extractedData.vendor && (
                      <span><span className="font-medium">Vendor:</span> {extractedData.vendor}</span>
                    )}
                    {extractedData.order_number && (
                      <span><span className="font-medium">Order #:</span> {extractedData.order_number}</span>
                    )}
                    {extractedData.total != null && (
                      <span>
                        <span className="font-medium">Total:</span>{" "}
                        {extractedData.currency || "$"}{extractedData.total}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Stock Location */}
              <div className="flex flex-col gap-y-2">
                <Label size="small" weight="plus">Stock Location</Label>
                <Select value={stockLocationId} onValueChange={setStockLocationId}>
                  <Select.Trigger className="w-full max-w-sm">
                    <Select.Value placeholder="Select a stock location..." />
                  </Select.Trigger>
                  <Select.Content>
                    {(stock_locations ?? []).map((loc: any) => (
                      <Select.Item key={loc.id} value={loc.id}>
                        {loc.name}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </div>

              {/* Item Mappings */}
              <div className="flex flex-col gap-y-4">
                <Heading level="h2">Item Mappings</Heading>
                {extractedItems.length === 0 ? (
                  <Text className="text-ui-fg-subtle">
                    No items extracted from the email.
                  </Text>
                ) : (
                  <div className="space-y-4">
                    {extractedItems.map((item, i) => (
                      <div key={i} className="border border-ui-border-base rounded-lg p-4 space-y-3">
                        <div>
                          <Text className="font-medium txt-compact-small-plus">
                            {item.name || `Item ${i + 1}`}
                          </Text>
                          {item.sku && (
                            <Text size="small" className="text-ui-fg-muted font-mono">
                              SKU: {item.sku}
                            </Text>
                          )}
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          <div className="flex flex-col gap-y-1">
                            <Label size="xsmall">Inventory Item ID</Label>
                            <Input
                              size="small"
                              placeholder="iitem_..."
                              value={itemMappings[i]?.inventory_item_id || ""}
                              onChange={(e) =>
                                updateMapping(i, "inventory_item_id", e.target.value)
                              }
                            />
                          </div>
                          <div className="flex flex-col gap-y-1">
                            <Label size="xsmall">Quantity</Label>
                            <Input
                              size="small"
                              type="number"
                              value={itemMappings[i]?.quantity || 0}
                              onChange={(e) =>
                                updateMapping(i, "quantity", Number(e.target.value))
                              }
                            />
                          </div>
                          <div className="flex flex-col gap-y-1">
                            <Label size="xsmall">Price</Label>
                            <Input
                              size="small"
                              type="number"
                              step="0.01"
                              value={itemMappings[i]?.price || 0}
                              onChange={(e) =>
                                updateMapping(i, "price", Number(e.target.value))
                              }
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          </div>
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
  )
}

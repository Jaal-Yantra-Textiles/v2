"use client"

import { HttpTypes } from "@medusajs/types"
import {
  Alert,
  Button,
  Checkbox,
  Heading,
  Label,
  Select,
  Text,
  Textarea,
} from "@medusajs/ui"
import { useState, useEffect } from "react"
import {
  createReturnRequest,
  listReturnReasons,
  ReturnReason,
  ReturnShippingOption,
} from "@lib/data/orders"
import { convertToLocale } from "@lib/util/money"
import Thumbnail from "@modules/products/components/thumbnail"
import Divider from "@modules/common/components/divider"

type ReturnRequestProps = {
  order: HttpTypes.StoreOrder
  returnShippingOptions: ReturnShippingOption[]
}

type SelectedItem = {
  id: string
  quantity: number
  reason_id?: string
  note?: string
}

const ReturnRequest = ({ order, returnShippingOptions }: ReturnRequestProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const [reasons, setReasons] = useState<ReturnReason[]>([])
  const [selectedShippingOption, setSelectedShippingOption] = useState<string>(
    returnShippingOptions.length === 1 ? returnShippingOptions[0].id : ""
  )
  const [selectedItems, setSelectedItems] = useState<
    Map<string, SelectedItem>
  >(new Map())
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fulfillmentStatus = (order as any).fulfillment_status
  const canReturn =
    fulfillmentStatus === "fulfilled" ||
    fulfillmentStatus === "partially_fulfilled" ||
    fulfillmentStatus === "shipped" ||
    fulfillmentStatus === "partially_shipped" ||
    fulfillmentStatus === "delivered" ||
    fulfillmentStatus === "partially_delivered"

  const returnableItems = (order.items || []).filter((item) => {
    const detail = (item as any).detail
    if (!detail) return false
    const returnedQty =
      (detail.return_requested_quantity || 0) +
      (detail.return_received_quantity || 0)
    const deliveredQty =
      detail.delivered_quantity || detail.shipped_quantity || detail.fulfilled_quantity || 0
    return deliveredQty > returnedQty
  })

  useEffect(() => {
    if (isOpen && reasons.length === 0) {
      listReturnReasons().then(setReasons)
    }
  }, [isOpen, reasons.length])

  if (!canReturn || returnableItems.length === 0 || returnShippingOptions.length === 0) {
    return null
  }

  const toggleItem = (itemId: string) => {
    const next = new Map(selectedItems)
    if (next.has(itemId)) {
      next.delete(itemId)
    } else {
      next.set(itemId, { id: itemId, quantity: 1 })
    }
    setSelectedItems(next)
  }

  const updateItemQuantity = (itemId: string, quantity: string) => {
    const next = new Map(selectedItems)
    const item = next.get(itemId)
    if (item) {
      next.set(itemId, { ...item, quantity: Number(quantity) })
    }
    setSelectedItems(next)
  }

  const updateItemReason = (itemId: string, reasonId: string) => {
    const next = new Map(selectedItems)
    const item = next.get(itemId)
    if (item) {
      next.set(itemId, { ...item, reason_id: reasonId })
    }
    setSelectedItems(next)
  }

  const updateItemNote = (itemId: string, note: string) => {
    const next = new Map(selectedItems)
    const item = next.get(itemId)
    if (item) {
      next.set(itemId, { ...item, note })
    }
    setSelectedItems(next)
  }

  const handleSubmit = async () => {
    if (selectedItems.size === 0) return
    if (!selectedShippingOption) {
      setError("Please select a return shipping method.")
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      await createReturnRequest({
        order_id: order.id,
        items: Array.from(selectedItems.values()),
        return_shipping: {
          option_id: selectedShippingOption,
        },
      })
      setSuccess(true)
      setSelectedItems(new Map())
    } catch (err: any) {
      setError(err?.message || "Failed to submit return request. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  const formatPrice = (opt: ReturnShippingOption) =>
    convertToLocale({
      amount: opt.calculated_price?.calculated_amount ?? opt.amount,
      currency_code: opt.calculated_price?.currency_code ?? order.currency_code,
    })

  if (success) {
    return (
      <div>
        <Divider className="!mb-0" />
        <div className="py-6">
          <Alert variant="success">
            <strong>Return request submitted</strong> — We&apos;ve received your
            request and will review it shortly. You&apos;ll receive an email
            with return instructions.
          </Alert>
        </div>
      </div>
    )
  }

  return (
    <div>
      <Divider className="!mb-0" />
      <div className="py-6">
        {!isOpen ? (
          <Button
            variant="secondary"
            onClick={() => setIsOpen(true)}
            className="w-full"
          >
            Request a return
          </Button>
        ) : (
          <div className="flex flex-col gap-y-4">
            <div className="flex items-center justify-between">
              <Heading level="h2" className="text-xl">
                Request a return
              </Heading>
              <Button
                variant="transparent"
                size="small"
                onClick={() => {
                  setIsOpen(false)
                  setSelectedItems(new Map())
                  setError(null)
                }}
              >
                Cancel
              </Button>
            </div>

            <Text className="txt-medium text-ui-fg-subtle">
              Select the items you&apos;d like to return and provide a reason.
            </Text>

            {/* Item selection */}
            <ul className="flex flex-col gap-y-3">
              {returnableItems.map((item) => {
                const detail = (item as any).detail
                const returnedQty =
                  (detail?.return_requested_quantity || 0) +
                  (detail?.return_received_quantity || 0)
                const maxQty =
                  (detail?.delivered_quantity ||
                    detail?.shipped_quantity ||
                    detail?.fulfilled_quantity ||
                    0) - returnedQty
                const isSelected = selectedItems.has(item.id)
                const selected = selectedItems.get(item.id)

                return (
                  <li
                    key={item.id}
                    className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                      isSelected
                        ? "border-ui-border-interactive bg-ui-bg-highlight"
                        : "border-ui-border-base hover:border-ui-border-strong"
                    }`}
                    onClick={() => !isSelected && toggleItem(item.id)}
                  >
                    <div className="flex items-center gap-x-3">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleItem(item.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="w-12 flex-shrink-0">
                        <Thumbnail
                          thumbnail={item.thumbnail}
                          size="square"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <Text className="txt-medium-plus text-ui-fg-base truncate">
                          {item.product_title || item.title}
                        </Text>
                        {item.variant_title && (
                          <Text className="txt-small text-ui-fg-subtle">
                            {item.variant_title}
                          </Text>
                        )}
                        <Text className="txt-small text-ui-fg-muted">
                          Max returnable: {maxQty}
                        </Text>
                      </div>
                    </div>

                    {isSelected && (
                      <div
                        className="mt-4 pl-8 flex flex-col gap-y-3"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {/* Quantity */}
                        <div className="flex items-center gap-x-3">
                          <Label size="small" className="w-16 text-ui-fg-subtle">
                            Qty
                          </Label>
                          <Select
                            size="small"
                            value={String(selected?.quantity || 1)}
                            onValueChange={(v) =>
                              updateItemQuantity(item.id, v)
                            }
                          >
                            <Select.Trigger className="w-20">
                              <Select.Value />
                            </Select.Trigger>
                            <Select.Content>
                              {Array.from(
                                { length: maxQty },
                                (_, i) => i + 1
                              ).map((q) => (
                                <Select.Item key={q} value={String(q)}>
                                  {q}
                                </Select.Item>
                              ))}
                            </Select.Content>
                          </Select>
                        </div>

                        {/* Reason */}
                        {reasons.length > 0 && (
                          <div className="flex items-center gap-x-3">
                            <Label
                              size="small"
                              className="w-16 text-ui-fg-subtle"
                            >
                              Reason
                            </Label>
                            <Select
                              size="small"
                              value={selected?.reason_id || ""}
                              onValueChange={(v) =>
                                updateItemReason(item.id, v)
                              }
                            >
                              <Select.Trigger className="flex-1">
                                <Select.Value placeholder="Select a reason" />
                              </Select.Trigger>
                              <Select.Content>
                                {reasons.map((r) => (
                                  <Select.Item key={r.id} value={r.id}>
                                    {r.label}
                                  </Select.Item>
                                ))}
                              </Select.Content>
                            </Select>
                          </div>
                        )}

                        {/* Note */}
                        <div className="flex items-start gap-x-3">
                          <Label
                            size="small"
                            className="w-16 pt-2 text-ui-fg-subtle"
                          >
                            Note
                          </Label>
                          <Textarea
                            value={selected?.note || ""}
                            onChange={(e) =>
                              updateItemNote(item.id, e.target.value)
                            }
                            placeholder="Optional details..."
                            rows={2}
                            className="flex-1"
                          />
                        </div>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>

            {/* Return shipping method */}
            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">
                Return shipping
              </Label>
              {returnShippingOptions.length > 1 ? (
                <Select
                  value={selectedShippingOption}
                  onValueChange={setSelectedShippingOption}
                >
                  <Select.Trigger>
                    <Select.Value placeholder="Select shipping method" />
                  </Select.Trigger>
                  <Select.Content>
                    {returnShippingOptions.map((opt) => (
                      <Select.Item key={opt.id} value={opt.id}>
                        {opt.name} ({formatPrice(opt)})
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              ) : (
                <Text className="txt-medium text-ui-fg-subtle">
                  {returnShippingOptions[0]?.name} ({formatPrice(returnShippingOptions[0])})
                </Text>
              )}
            </div>

            {error && (
              <Alert variant="error">{error}</Alert>
            )}

            <Button
              onClick={handleSubmit}
              disabled={
                selectedItems.size === 0 ||
                !selectedShippingOption ||
                submitting
              }
              isLoading={submitting}
            >
              {submitting
                ? "Submitting..."
                : `Submit return (${selectedItems.size} item${selectedItems.size !== 1 ? "s" : ""})`}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

export default ReturnRequest

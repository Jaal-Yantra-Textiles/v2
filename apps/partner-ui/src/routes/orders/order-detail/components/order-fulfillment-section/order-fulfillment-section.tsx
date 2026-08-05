import { Buildings, XCircle } from "@medusajs/icons"
import {
  AdminOrder,
  AdminOrderFulfillment,
  AdminOrderLineItem,
  HttpTypes,
  OrderLineItemDTO,
} from "@medusajs/types"
import {
  Badge,
  Button,
  Container,
  Copy,
  Drawer,
  Heading,
  Input,
  Label,
  StatusBadge,
  Text,
  Tooltip,
  toast,
  usePrompt,
  DatePicker,
} from "@medusajs/ui"

import { format } from "date-fns"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useNavigate } from "react-router-dom"
import { ActionMenu } from "../../../../../components/common/action-menu"
import { Skeleton } from "../../../../../components/common/skeleton"
import { Thumbnail } from "../../../../../components/common/thumbnail"
import {
  useCancelOrderFulfillment,
  useFulfillmentLabel,
  useFulfillmentTracking,
  useMarkOrderFulfillmentAsDelivered,
  useSchedulePickup,
} from "../../../../../hooks/api/orders"
import { useStockLocation } from "../../../../../hooks/api/stock-locations"
import { formatProvider } from "../../../../../lib/format-provider"
import { getLocaleAmount } from "../../../../../lib/money-amount-helpers"
import { FulfillmentSetType } from "../../../../locations/common/constants"
import { FulfillmentTrackingTimeline } from "./fulfillment-tracking-timeline"

/** DatePicker works in Date objects; the API wants "YYYY-MM-DD" (local). */
const toYMD = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`

type OrderFulfillmentSectionProps = {
  order: AdminOrder
}

export const OrderFulfillmentSection = ({
  order,
}: OrderFulfillmentSectionProps) => {
  const fulfillments = order.fulfillments || []

  return (
    <div className="flex flex-col gap-y-3">
      <UnfulfilledItemBreakdown order={order} />
      {fulfillments.map((f, index) => (
        <Fulfillment key={f.id} index={index} fulfillment={f} order={order} />
      ))}
    </div>
  )
}

const UnfulfilledItem = ({
  item,
  currencyCode,
}: {
  item: OrderLineItemDTO & { variant: HttpTypes.AdminProductVariant }
  currencyCode: string
}) => {
  return (
    <div
      key={item.id}
      className="text-ui-fg-subtle grid grid-cols-2 items-start px-6 py-4"
    >
      <div className="flex items-start gap-x-4">
        <Thumbnail src={item.thumbnail} />
        <div>
          <Text
            size="small"
            leading="compact"
            weight="plus"
            className="text-ui-fg-base"
          >
            {item.title}
          </Text>
          {item.variant_sku && (
            <div className="flex items-center gap-x-1">
              <Text size="small">{item.variant_sku}</Text>
              <Copy content={item.variant_sku} className="text-ui-fg-muted" />
            </div>
          )}
          <Text size="small">
            {item.variant?.options.map((o) => o.value).join(" · ")}
          </Text>
        </div>
      </div>
      <div className="grid grid-cols-3 items-center gap-x-4">
        <div className="flex items-center justify-end">
          <Text size="small">
            {getLocaleAmount(item.unit_price, currencyCode)}
          </Text>
        </div>
        <div className="flex items-center justify-end">
          <Text>
            <span className="tabular-nums">
              {item.quantity - item.detail.fulfilled_quantity}
            </span>
            x
          </Text>
        </div>
        <div className="flex items-center justify-end">
          <Text size="small">
            {getLocaleAmount(item.subtotal || 0, currencyCode)}
          </Text>
        </div>
      </div>
    </div>
  )
}

const UnfulfilledItemBreakdown = ({ order }: { order: AdminOrder }) => {
  // Create an array of order items that haven't been fulfilled or at least not fully fulfilled
  const unfulfilledItemsWithShipping = order.items!.filter(
    (i) => i.requires_shipping && i.detail.fulfilled_quantity < i.quantity
  )

  const unfulfilledItemsWithoutShipping = order.items!.filter(
    (i) => !i.requires_shipping && i.detail.fulfilled_quantity < i.quantity
  )

  return (
    <>
      {!!unfulfilledItemsWithShipping.length && (
        <UnfulfilledItemDisplay
          order={order}
          unfulfilledItems={unfulfilledItemsWithShipping}
          requiresShipping={true}
        />
      )}

      {!!unfulfilledItemsWithoutShipping.length && (
        <UnfulfilledItemDisplay
          order={order}
          unfulfilledItems={unfulfilledItemsWithoutShipping}
          requiresShipping={false}
        />
      )}
    </>
  )
}

const UnfulfilledItemDisplay = ({
  order,
  unfulfilledItems,
  requiresShipping = false,
}: {
  order: AdminOrder
  unfulfilledItems: AdminOrderLineItem[]
  requiresShipping: boolean
}) => {
  const { t } = useTranslation()

  if (order.status === "canceled") {
    return
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-y-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <Heading level="h2">{t("orders.fulfillment.unfulfilledItems")}</Heading>

        <div className="flex items-center gap-x-4">
          {requiresShipping && (
            <StatusBadge color="red" className="text-nowrap">
              {t("orders.fulfillment.requiresShipping")}
            </StatusBadge>
          )}

          <StatusBadge color="red" className="text-nowrap">
            {t("orders.fulfillment.awaitingFulfillmentBadge")}
          </StatusBadge>

          <ActionMenu
            groups={[
              {
                actions: [
                  {
                    label: t("orders.fulfillment.fulfillItems"),
                    icon: <Buildings />,
                    to: `/orders/${order.id}/fulfillment?requires_shipping=${requiresShipping}`,
                  },
                ],
              },
            ]}
          />
        </div>
      </div>
      <div>
        {unfulfilledItems.map((item: AdminOrderLineItem) => (
          <UnfulfilledItem
            key={item.id}
            item={item}
            currencyCode={order.currency_code}
          />
        ))}
      </div>
    </Container>
  )
}

const Fulfillment = ({
  fulfillment,
  order,
  index,
}: {
  fulfillment: AdminOrderFulfillment
  order: AdminOrder
  index: number
}) => {
  const { t } = useTranslation()
  const prompt = usePrompt()
  const navigate = useNavigate()

  const [showTracking, setShowTracking] = useState(false)
  const [showPickupForm, setShowPickupForm] = useState(false)
  const [pickupDate, setPickupDate] = useState("")
  const [pickupTime, setPickupTime] = useState("")

  const showLocation = !!fulfillment.location_id

  const isPickUpFulfillment =
    fulfillment.shipping_option?.service_zone.fulfillment_set.type ===
    FulfillmentSetType.Pickup

  const { stock_location, isError, error, isLoading } = useStockLocation(
    fulfillment.location_id!,
    undefined,
    {
      enabled: showLocation,
    }
  )

  // #1195: keyed off the fulfillment set type, not `requires_shipping` — the
  // flag is false for most of the catalogue, which read "Awaiting delivery"
  // next to a shipment action.
  let statusText = isPickUpFulfillment ? "Awaiting pickup" : "Awaiting shipping"
  let statusColor: "blue" | "green" | "red" = "blue"
  let statusTimestamp = fulfillment.created_at

  if (fulfillment.canceled_at) {
    statusText = "Canceled"
    statusColor = "red"
    statusTimestamp = fulfillment.canceled_at
  } else if (fulfillment.delivered_at) {
    statusText = "Delivered"
    statusColor = "green"
    statusTimestamp = fulfillment.delivered_at
  } else if (fulfillment.shipped_at) {
    statusText = "Shipped"
    statusColor = "green"
    statusTimestamp = fulfillment.shipped_at
  }

  const { mutateAsync } = useCancelOrderFulfillment(order.id, fulfillment.id)
  const { mutateAsync: markAsDelivered } = useMarkOrderFulfillmentAsDelivered(
    order.id,
    fulfillment.id
  )

  // Label fetch (on demand)
  const { refetch: fetchLabel, isFetching: isLabelFetching } =
    useFulfillmentLabel(order.id, fulfillment.id)

  // Tracking (only when expanded)
  const {
    tracking,
    isLoading: isTrackingLoading,
  } = useFulfillmentTracking(order.id, fulfillment.id, {
    enabled: showTracking,
  }) as any

  // Pickup scheduling
  const { mutateAsync: schedulePickup, isPending: isPickupPending } =
    useSchedulePickup(order.id, fulfillment.id)

  const isDelhivery = (fulfillment as any).data?.carrier === "delhivery"
  const hasWaybill = !!(fulfillment as any).data?.waybill

  // #1195: `requires_shipping` is NOT a reliable gate. It is derived from
  // `hasShippingProfile || someInventoryRequiresShipping`
  // (core-flows prepare-line-item-data.js:23-29) and copied onto the
  // fulfillment — so a product with no shipping profile whose variants are
  // `manage_inventory: false` lands on `false` and hides the shipment action
  // entirely. That's most of our catalogue. The only restriction the Medusa
  // user guide actually documents is the pickup one, so that's the only one we
  // gate on; every fulfillment we create goes out through the manual shipping
  // side-channel regardless of the flag.
  //
  // This button is now the entry point to the WHOLE ship flow (pick carrier →
  // label/AWB → confirm shipment), not just the confirm step, so it must be
  // reachable in the no-waybill case the removed inline carrier actions used
  // to cover.
  const showShippingButton =
    !fulfillment.canceled_at &&
    !fulfillment.shipped_at &&
    !fulfillment.delivered_at &&
    !isPickUpFulfillment

  const showDeliveryButton =
    !fulfillment.canceled_at && !fulfillment.delivered_at

  const showPickupButton =
    isDelhivery &&
    hasWaybill &&
    !fulfillment.canceled_at &&
    !fulfillment.delivered_at &&
    !(fulfillment as any).metadata?.pickup_id

  const handleFetchLabel = async () => {
    try {
      const result = await fetchLabel()
      const labelData = result.data as any
      if (labelData?.packing_slip) {
        // Open packing slip data in a new tab as printable HTML
        const html = `<html><head><title>Packing Slip - ${labelData.tracking_number}</title></head><body><pre>${JSON.stringify(labelData.packing_slip, null, 2)}</pre><script>window.print()</script></body></html>`
        const blob = new Blob([html], { type: "text/html" })
        const url = URL.createObjectURL(blob)
        window.open(url, "_blank")
      } else if (labelData?.label_url) {
        window.open(labelData.label_url, "_blank")
      } else {
        toast.info("Label not yet available. Please try again later.")
      }
    } catch {
      toast.error("Failed to fetch label")
    }
  }

  const handleSchedulePickup = async () => {
    if (!pickupDate || !pickupTime) {
      toast.error("Please select a date and time")
      return
    }

    try {
      await schedulePickup(
        { pickup_date: pickupDate, pickup_time: pickupTime },
        {
          onSuccess: () => {
            toast.success("Pickup scheduled successfully")
            setShowPickupForm(false)
          },
          onError: (e) => {
            toast.error(e.message)
          },
        }
      )
    } catch {
      // handled by onError
    }
  }

  const handleMarkAsDelivered = async () => {
    const res = await prompt({
      title: t("general.areYouSure"),
      description: t("orders.fulfillment.markAsDeliveredWarning"),
      confirmText: t("actions.continue"),
      cancelText: t("actions.cancel"),
      variant: "confirmation",
    })

    if (res) {
      await markAsDelivered(undefined, {
        onSuccess: () => {
          toast.success(
            t(
              isPickUpFulfillment
                ? "orders.fulfillment.toast.fulfillmentPickedUp"
                : "orders.fulfillment.toast.fulfillmentDelivered"
            )
          )
        },
        onError: (e) => {
          toast.error(e.message)
        },
      })
    }
  }

  const handleCancel = async () => {
    if (fulfillment.shipped_at) {
      toast.warning(t("orders.fulfillment.toast.fulfillmentShipped"))
      return
    }

    const res = await prompt({
      title: t("general.areYouSure"),
      description: t("orders.fulfillment.cancelWarning"),
      confirmText: t("actions.continue"),
      cancelText: t("actions.cancel"),
    })

    if (res) {
      await mutateAsync(undefined, {
        onSuccess: () => {
          toast.success(t("orders.fulfillment.toast.canceled"))
        },
        onError: (e) => {
          toast.error(e.message)
        },
      })
    }
  }

  // Deliberately NOT `throw error`. This is a decorative lookup — it supplies
  // one warehouse name on the fulfillment card — but rethrowing sent it to the
  // error boundary and blanked the ENTIRE order detail page.
  //
  // It fails for real, reachable orders: a partner whose store exists but whose
  // fulfillment shipped from a location other than `store.default_location_id`
  // gets a 404 from `/partners/stores/:id/locations/:locationId`, which
  // hard-requires that equality. Work orders fulfilled from JYT's own warehouse
  // are exactly that case.
  //
  // `stock_location` is already optional and `showLocation` gates the row, so
  // degrading costs one line of the card instead of the whole page.
  if (isError) {
    console.warn(
      `[order-fulfillment] stock location ${fulfillment.location_id} unavailable:`,
      error
    )
  }

  const isValidUrl = (url?: string) => url && url.length > 0 && url !== "#"

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-y-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <Heading level="h2">
          {t("orders.fulfillment.number", {
            number: index + 1,
          })}
        </Heading>
        <div className="flex items-center gap-x-4">
          {(fulfillment as any).metadata?.pickup_id && (
            <StatusBadge color="blue" className="text-nowrap">
              Pickup Scheduled
              {(fulfillment as any).metadata?.pickup_date &&
                ` — ${format(
                  new Date((fulfillment as any).metadata.pickup_date),
                  "dd MMM, HH:mm"
                )}`}
            </StatusBadge>
          )}
          <Tooltip
            content={format(
              new Date(statusTimestamp),
              "dd MMM, yyyy, HH:mm:ss"
            )}
          >
            <StatusBadge color={statusColor} className="text-nowrap">
              {statusText}
            </StatusBadge>
          </Tooltip>
          <ActionMenu
            groups={[
              {
                actions: [
                  {
                    label: t("actions.cancel"),
                    icon: <XCircle />,
                    onClick: handleCancel,
                    disabled:
                      !!fulfillment.canceled_at ||
                      !!fulfillment.shipped_at ||
                      !!fulfillment.delivered_at,
                  },
                ],
              },
            ]}
          />
        </div>
      </div>
      <div className="text-ui-fg-subtle grid grid-cols-2 items-start px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          {t("orders.fulfillment.itemsLabel")}
        </Text>
        <ul>
          {fulfillment.items.map((f_item) => (
            <li key={f_item.line_item_id}>
              <Text size="small" leading="compact">
                {f_item.quantity}x {f_item.title}
              </Text>
            </li>
          ))}
        </ul>
      </div>
      {showLocation && (
        <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
          <Text size="small" leading="compact" weight="plus">
            {t("orders.fulfillment.shippingFromLabel")}
          </Text>
          {stock_location ? (
            <Link
              to={`/settings/locations/${stock_location.id}`}
              className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover transition-fg"
            >
              <Text size="small" leading="compact">
                {stock_location.name}
              </Text>
            </Link>
          ) : isLoading ? (
            <Skeleton className="w-16" />
          ) : (
            // Unresolvable (storeless partner, or a location that isn't the
            // store's default). A skeleton here shimmers forever and reads as
            // "still loading"; say plainly that we don't have the name.
            <Text size="small" leading="compact" className="text-ui-fg-muted">
              &mdash;
            </Text>
          )}
        </div>
      )}
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          {t("fields.provider")}
        </Text>

        <Text size="small" leading="compact">
          {formatProvider(fulfillment.provider_id)}
        </Text>
      </div>
      {/* Auto-selected carrier courier + quoted rate (#1116 / #1118 partner
          parity) — sourced from the fulfillment's stamped provider_refs, so no
          extra fetch. Only shown once the carrier flow has resolved a courier. */}
      {(() => {
        const refs = (fulfillment as any).data?.provider_refs
        const courierName: string | undefined = refs?.courier_name
        const rate = refs?.courier_rate
        const hasRate = rate != null && Number.isFinite(Number(rate))
        const isInternational = !!refs?.international
        if (!courierName && !hasRate && !isInternational) return null
        return (
          <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
            <Text size="small" leading="compact" weight="plus">
              Courier
            </Text>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {courierName && (
                <Text size="small" leading="compact">
                  {courierName}
                </Text>
              )}
              {isInternational && (
                <Badge size="2xsmall" color="purple">
                  International
                </Badge>
              )}
              {hasRate && (
                <Text
                  size="small"
                  leading="compact"
                  className="text-ui-fg-muted"
                >
                  {getLocaleAmount(
                    Number(rate),
                    refs?.courier_rate_currency || order.currency_code
                  )}
                </Text>
              )}
            </div>
          </div>
        )
      })()}
      <div className="text-ui-fg-subtle grid grid-cols-2 items-start px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          {t("orders.fulfillment.trackingLabel")}
        </Text>
        <div>
          {fulfillment.labels && fulfillment.labels.length > 0 ? (
            <ul>
              {fulfillment.labels.map((tlink) => {
                const hasTrackingUrl = isValidUrl(tlink.tracking_url)
                const hasLabelUrl = isValidUrl(tlink.label_url)

                if (hasTrackingUrl || hasLabelUrl) {
                  return (
                    <li key={tlink.tracking_number}>
                      {hasTrackingUrl && (
                        <a
                          href={tlink.tracking_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover transition-fg"
                        >
                          <Text size="small" leading="compact" as="span">
                            {tlink.tracking_number}
                          </Text>
                        </a>
                      )}
                      {hasTrackingUrl && hasLabelUrl && " - "}
                      {hasLabelUrl && (
                        <a
                          href={tlink.label_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover transition-fg"
                        >
                          <Text size="small" leading="compact" as="span">
                            Label
                          </Text>
                        </a>
                      )}
                    </li>
                  )
                }

                return (
                  <li key={tlink.tracking_number}>
                    <Text size="small" leading="compact">
                      {tlink.tracking_number}
                    </Text>
                  </li>
                )
              })}
            </ul>
          ) : (
            <Text size="small" leading="compact">
              -
            </Text>
          )}
        </div>
      </div>

      {/* Tracking timeline (collapsible) */}
      {hasWaybill && !fulfillment.canceled_at && (
        <div>
          <button
            onClick={() => setShowTracking(!showTracking)}
            className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover w-full px-6 py-3 text-left text-sm transition-colors"
          >
            {showTracking ? "Hide Tracking" : "View Tracking"}
          </button>
          {showTracking && (
            <FulfillmentTrackingTimeline
              tracking={tracking}
              isLoading={isTrackingLoading}
            />
          )}
        </div>
      )}

      {/* Pickup scheduling — Medusa side drawer */}
      <Drawer open={showPickupForm} onOpenChange={setShowPickupForm}>
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>Schedule Pickup</Drawer.Title>
            <Drawer.Description>
              Choose when the carrier should collect this fulfillment.
            </Drawer.Description>
          </Drawer.Header>
          <Drawer.Body className="flex flex-col gap-y-4 overflow-y-auto">
            <div className="grid grid-cols-2 gap-x-4">
              <div>
                <Label size="xsmall">Pickup Date</Label>
                <DatePicker
                  size="small"
                  value={pickupDate ? new Date(`${pickupDate}T00:00:00`) : null}
                  onChange={(d) => setPickupDate(d ? toYMD(d) : "")}
                />
              </div>
              <div>
                <Label size="xsmall">Pickup Time</Label>
                <Input
                  type="time"
                  value={pickupTime}
                  onChange={(e) => setPickupTime(e.target.value)}
                  size="small"
                />
              </div>
            </div>
          </Drawer.Body>
          <Drawer.Footer>
            <Button
              onClick={() => setShowPickupForm(false)}
              variant="secondary"
              size="small"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSchedulePickup}
              variant="primary"
              size="small"
              isLoading={isPickupPending}
            >
              Confirm Pickup
            </Button>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer>

      {/* Carrier actions (provider select / Attach AWB / Generate Label) used to
          live here as an inline button row. They now open as step 1 of the
          "Mark as shipped" route-focus modal below, so picking a carrier,
          getting a waybill and confirming the shipment is one sequence. */}

      {(showShippingButton ||
        showDeliveryButton ||
        hasWaybill ||
        showPickupButton) && (
        <div className="bg-ui-bg-subtle flex items-center justify-end gap-x-2 rounded-b-xl px-4 py-4">
          {hasWaybill && !fulfillment.canceled_at && (
            <Button
              onClick={handleFetchLabel}
              variant="secondary"
              isLoading={isLabelFetching}
            >
              Download Label
            </Button>
          )}

          {showPickupButton && (
            <Button
              onClick={() => setShowPickupForm(true)}
              variant="secondary"
            >
              Schedule Pickup
            </Button>
          )}

          {showDeliveryButton && (
            <Button onClick={handleMarkAsDelivered} variant="secondary">
              {t(
                isPickUpFulfillment
                  ? "orders.fulfillment.markAsPickedUp"
                  : "orders.fulfillment.markAsDelivered"
              )}
            </Button>
          )}

          {showShippingButton && (
            <Button
              onClick={() => navigate(`./${fulfillment.id}/create-shipment`)}
              variant="secondary"
            >
              {t("orders.fulfillment.markAsShipped")}
            </Button>
          )}
        </div>
      )}
    </Container>
  )
}

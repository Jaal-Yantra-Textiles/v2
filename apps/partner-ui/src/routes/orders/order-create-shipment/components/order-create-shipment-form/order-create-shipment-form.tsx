import { zodResolver } from "@hookform/resolvers/zod"
import { useTranslation } from "react-i18next"
import { z as zod } from "@medusajs/framework/zod"

import { AdminFulfillment, AdminOrder } from "@medusajs/types"
import { Button, ProgressStatus, ProgressTabs, toast } from "@medusajs/ui"
import { useState } from "react"
import { useFieldArray, useForm } from "react-hook-form"

import {
  RouteFocusModal,
  useRouteModal,
} from "../../../../../components/modals"
import { KeyboundForm } from "../../../../../components/utilities/keybound-form"
import { useDocumentDirection } from "../../../../../hooks/use-document-direction"
import { useCreateOrderShipment } from "../../../../../hooks/api"
import { CarrierTab, CarrierOutcome } from "./carrier-tab"
import { CreateShipmentSchema } from "./constants"
import { ShipmentTab } from "./shipment-tab"

/**
 * "Mark as shipped" as a two-step flow.
 *
 * Step 1 (carrier) is where the provider is picked and a label generated or an
 * existing AWB attached — actions that used to sit as loose buttons on the
 * fulfillment card. Step 2 confirms the shipment.
 *
 * The steps are deliberately NOT coupled: a partner can generate a label and
 * close the modal, and the fulfillment stays un-shipped. Only submitting step 2
 * calls `createShipment` / sets `shipped_at`. Labelling has never implied
 * shipping in this system and it still doesn't.
 */

enum Tab {
  CARRIER = "carrier",
  SHIPMENT = "shipment",
}

type OrderCreateFulfillmentFormProps = {
  order: AdminOrder
  fulfillment: AdminFulfillment
}

export function OrderCreateShipmentForm({
  order,
  fulfillment,
}: OrderCreateFulfillmentFormProps) {
  const { t } = useTranslation()
  const { handleSuccess } = useRouteModal()
  const direction = useDocumentDirection()

  const { mutateAsync: createShipment, isPending: isMutating } =
    useCreateOrderShipment(order.id, fulfillment?.id)

  // An AWB already stamped on the fulfillment means the carrier step is
  // satisfied on arrival — jump straight to confirming the shipment.
  const hasExistingAwb = !!(
    (fulfillment as any)?.data?.waybill || fulfillment?.labels?.length
  )

  const [tab, setTab] = useState<Tab>(
    hasExistingAwb ? Tab.SHIPMENT : Tab.CARRIER
  )
  const [carrierDone, setCarrierDone] = useState(hasExistingAwb)

  const form = useForm<zod.infer<typeof CreateShipmentSchema>>({
    defaultValues: {
      carrier: (fulfillment as any)?.data?.carrier || "shiprocket",
      labels: [],
      send_notification: !order.no_notification,
    },
    resolver: zodResolver(CreateShipmentSchema),
  })

  const { fields: labels, append, replace } = useFieldArray({
    name: "labels",
    control: form.control,
  })

  const tabState: Record<Tab, ProgressStatus> = {
    [Tab.CARRIER]: carrierDone
      ? "completed"
      : tab === Tab.CARRIER
      ? "in-progress"
      : "not-started",
    [Tab.SHIPMENT]: tab === Tab.SHIPMENT ? "in-progress" : "not-started",
  }

  /**
   * A label was generated or an AWB attached. Prefill the tracking row from it
   * and advance — the partner shouldn't have to retype an AWB we just minted.
   */
  const handleCarrierResolved = (outcome: CarrierOutcome) => {
    replace([
      {
        tracking_number: outcome.awb,
        tracking_url: outcome.tracking_url || "",
        label_url: outcome.label_url || "",
      },
    ])
    setCarrierDone(true)
    setTab(Tab.SHIPMENT)
  }

  const handleSubmit = form.handleSubmit(async (data) => {
    const addedLabels = data.labels
      .filter((l) => !!l.tracking_number || !!l.tracking_url || !!l.label_url)
      .map((l) => ({
        tracking_number: l.tracking_number,
        tracking_url: l.tracking_url || "#",
        label_url: l.label_url || "#",
      }))

    // Merge, never replace: `createOrderShipmentWorkflow` treats `labels` as a
    // destructive overwrite, so omitting the fulfillment's existing labels
    // would wipe the AWB the carrier step just stamped on. Drop duplicates by
    // tracking number — step 1 prefills from the very label we're merging with.
    const existing = fulfillment?.labels || []
    const addedNumbers = new Set(addedLabels.map((l) => l.tracking_number))
    const merged = [
      ...addedLabels,
      ...existing.filter((l: any) => !addedNumbers.has(l.tracking_number)),
    ]

    await createShipment(
      {
        items: fulfillment?.items?.map((i) => ({
          id: i.line_item_id,
          quantity: i.quantity,
        })),
        labels: merged,
        no_notification: !data.send_notification,
      },
      {
        onSuccess: () => {
          toast.success(t("orders.shipment.toastCreated"))
          handleSuccess(`/orders/${order.id}`)
        },
        onError: (e) => {
          toast.error(e.message)
        },
      }
    )
  })

  return (
    <RouteFocusModal.Form form={form}>
      <ProgressTabs
        dir={direction}
        value={tab}
        onValueChange={(next) => setTab(next as Tab)}
        className="flex h-full flex-col overflow-hidden"
      >
        <KeyboundForm
          onSubmit={handleSubmit}
          className="flex h-full flex-col overflow-hidden"
        >
          <RouteFocusModal.Header>
            <div className="flex w-full items-center justify-between gap-x-4">
              <div className="-my-2 w-full max-w-[400px] border-l">
                <ProgressTabs.List className="grid w-full grid-cols-2">
                  <ProgressTabs.Trigger
                    status={tabState[Tab.CARRIER]}
                    value={Tab.CARRIER}
                  >
                    Carrier
                  </ProgressTabs.Trigger>
                  <ProgressTabs.Trigger
                    status={tabState[Tab.SHIPMENT]}
                    value={Tab.SHIPMENT}
                  >
                    Shipment
                  </ProgressTabs.Trigger>
                </ProgressTabs.List>
              </div>
            </div>
          </RouteFocusModal.Header>

          <RouteFocusModal.Body className="size-full overflow-hidden">
            <ProgressTabs.Content
              className="size-full overflow-y-auto"
              value={Tab.CARRIER}
            >
              <CarrierTab
                orderId={order.id}
                fulfillment={fulfillment}
                form={form}
                onCarrierResolved={handleCarrierResolved}
              />
            </ProgressTabs.Content>
            <ProgressTabs.Content
              className="size-full overflow-y-auto"
              value={Tab.SHIPMENT}
            >
              <ShipmentTab form={form} labels={labels} append={append} />
            </ProgressTabs.Content>
          </RouteFocusModal.Body>

          <RouteFocusModal.Footer>
            <RouteFocusModal.Close asChild>
              <Button size="small" variant="secondary">
                {t("actions.cancel")}
              </Button>
            </RouteFocusModal.Close>
            {tab === Tab.CARRIER ? (
              // Always skippable — a partner shipping on their own account
              // never touches our carrier at all.
              <Button
                size="small"
                type="button"
                variant="primary"
                onClick={() => setTab(Tab.SHIPMENT)}
              >
                {t("actions.continue")}
              </Button>
            ) : (
              <Button size="small" type="submit" isLoading={isMutating}>
                {t("orders.fulfillment.markAsShipped")}
              </Button>
            )}
          </RouteFocusModal.Footer>
        </KeyboundForm>
      </ProgressTabs>
    </RouteFocusModal.Form>
  )
}

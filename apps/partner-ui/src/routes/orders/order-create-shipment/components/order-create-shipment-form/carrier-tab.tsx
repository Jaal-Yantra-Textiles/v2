import { AdminFulfillment } from "@medusajs/types"
import {
  Badge,
  Button,
  Heading,
  Input,
  Label,
  Select,
  Text,
  toast,
} from "@medusajs/ui"
import { useState } from "react"
import { UseFormReturn } from "react-hook-form"
import { z as zod } from "@medusajs/framework/zod"

import {
  useAttachShiprocketAwb,
  useGenerateShiprocketLabel,
} from "../../../../../hooks/api/shiprocket"
import {
  CreateShipmentSchema,
  SHIPMENT_CARRIERS,
  carriersForDestination,
  isInternationalDestination,
} from "./constants"

/**
 * Step 1 of "Mark as shipped" — the carrier step (#639 follow-up).
 *
 * These actions used to sit inline on the fulfillment card as a bare row of
 * buttons. They live here now so the whole ship-a-parcel flow is one screen
 * sequence, but the semantics are unchanged and deliberately so: generating a
 * label or attaching an AWB does NOT set `shipped_at`. Every fulfillment goes
 * out through the manual shipping side-channel, and the parcel isn't shipped
 * until the partner says it was handed over — which is step 2. Closing the
 * modal here leaves the fulfillment un-shipped with its AWB attached.
 */

export type CarrierOutcome = {
  awb: string
  tracking_url?: string
  label_url?: string
}

type CarrierTabProps = {
  orderId: string
  fulfillment?: AdminFulfillment
  form: UseFormReturn<zod.infer<typeof CreateShipmentSchema>>
  /** Called with the AWB once a label is generated or an existing one attached. */
  onCarrierResolved: (outcome: CarrierOutcome) => void
  /** Destination country of the order — decides which carriers can serve it. */
  destinationCountry?: string | null
}

export const CarrierTab = ({
  orderId,
  fulfillment,
  form,
  onCarrierResolved,
  destinationCountry,
}: CarrierTabProps) => {
  const [awbInput, setAwbInput] = useState("")

  // Only offer carriers that can actually reach this destination. Delhivery is
  // domestic-only here (its exports are a separate Cross Border service), and
  // picking it for a foreign address just returns an opaque carrier error.
  const availableCarriers = carriersForDestination(destinationCountry)
  const isIntl = isInternationalDestination(destinationCountry)

  const selected = form.watch("carrier") || "shiprocket"
  // A carrier that can't serve this destination must not stay selected — the
  // default is `shiprocket` and the form may have been pre-filled from a
  // previous, domestic order.
  const carrier = availableCarriers.some((c) => c.value === selected)
    ? selected
    : availableCarriers[0]?.value || "shiprocket"
  const carrierLabel =
    SHIPMENT_CARRIERS.find((c) => c.value === carrier)?.label ?? carrier

  // An AWB already on the fulfillment (generated earlier, or attached on a
  // previous pass through this modal) — the step is already satisfied.
  const existingAwb: string | undefined =
    (fulfillment as any)?.data?.waybill ||
    fulfillment?.labels?.[0]?.tracking_number ||
    undefined
  const existingCarrier: string | undefined = (fulfillment as any)?.data?.carrier

  const { mutateAsync: generateLabel, isPending: isGenerating } =
    useGenerateShiprocketLabel(orderId)
  const { mutateAsync: attachAwb, isPending: isAttaching } =
    useAttachShiprocketAwb(orderId)

  const handleGenerate = async () => {
    try {
      const res = await generateLabel({ carrier })
      const label = res?.shiprocket_label
      const awb = label?.awb || label?.tracking_number
      if (!awb) {
        // The carrier accepted the shipment but hasn't assigned a waybill. Say
        // so plainly rather than advancing to a step with nothing to enter.
        toast.warning(
          `${carrierLabel} created the shipment but returned no AWB yet. Try again in a moment, or attach the AWB manually.`
        )
        return
      }
      toast.success(`${carrierLabel} label generated — AWB ${awb}`)
      onCarrierResolved({
        awb,
        tracking_url: label?.tracking_url,
        label_url: label?.label_url,
      })
    } catch (e: any) {
      toast.error(e?.message || "Failed to generate label")
    }
  }

  const handleAttach = async () => {
    const awb = awbInput.trim()
    if (!awb) {
      toast.error("Please enter an AWB number")
      return
    }
    try {
      const res = await attachAwb(awb)
      const attached = res?.shiprocket_awb
      toast.success(
        `AWB ${attached?.awb ?? awb} attached (${attached?.synced_state})`
      )
      setAwbInput("")
      onCarrierResolved({ awb: attached?.awb ?? awb })
    } catch (e: any) {
      toast.error(e?.message || "Failed to attach AWB")
    }
  }

  return (
    <div className="flex size-full flex-col items-center overflow-auto p-16">
      <div className="flex w-full max-w-[736px] flex-col gap-y-8 px-2 pb-2">
        <div>
          <Heading className="mb-1">Carrier</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Generate a label on our carrier account, or attach an AWB for a
            parcel booked elsewhere. Neither marks the fulfillment shipped —
            you confirm that on the next step.
          </Text>
        </div>

        {existingAwb ? (
          <div className="bg-ui-bg-subtle flex flex-col gap-y-2 rounded-lg px-4 py-3">
            <div className="flex items-center gap-x-2">
              <Badge size="2xsmall" color="green">
                AWB attached
              </Badge>
              <Text size="small" weight="plus">
                {existingAwb}
              </Text>
            </div>
            <Text size="small" className="text-ui-fg-subtle">
              This fulfillment already has a waybill
              {existingCarrier ? ` on ${existingCarrier}` : ""}. Continue to
              confirm the shipment, or replace it below.
            </Text>
          </div>
        ) : null}

        <div className="flex flex-col gap-y-3">
          <Label size="xsmall">Provider</Label>
          <Select
            value={carrier}
            onValueChange={(v) => form.setValue("carrier", v)}
          >
            <Select.Trigger className="w-full max-w-xs">
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {availableCarriers.map((c) => (
                <Select.Item key={c.value} value={c.value}>
                  {c.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
          {isIntl ? (
            <Text size="small" className="text-ui-fg-subtle">
              This order ships outside India, so only carriers with an export
              service are listed. Delhivery is domestic-only on this account —
              its exports run on Cross Border, a separate service.
            </Text>
          ) : null}
          <div>
            <Button
              type="button"
              variant="primary"
              onClick={handleGenerate}
              isLoading={isGenerating}
            >
              Generate {carrierLabel} label
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-y-3 border-t pt-8">
          <div>
            <Label size="xsmall">Attach an existing AWB</Label>
            <Text size="small" className="text-ui-fg-subtle">
              Link a waybill generated outside this system. We look it up, stamp
              it onto the fulfillment and sync its status.
            </Text>
          </div>
          <div className="flex items-start gap-x-2">
            <Input
              value={awbInput}
              onChange={(e) => setAwbInput(e.target.value)}
              placeholder="e.g. 14112363690867"
              className="max-w-xs"
            />
            <Button
              type="button"
              variant="secondary"
              onClick={handleAttach}
              isLoading={isAttaching}
            >
              Attach AWB
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

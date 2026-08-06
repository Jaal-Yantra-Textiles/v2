import { AdminFulfillment } from "@medusajs/types"
import {
  Badge,
  Button,
  clx,
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
  usePartnerShiprocketRates,
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

  // Courier selection (#641). Shiprocket-only — Delhivery auto-assigns and has
  // no courier picker. Fetched on demand (the request hits the live carrier),
  // quoting against the parcel weight entered above. A chosen courier threads
  // into generate as `preferred_courier_id`; none → the carrier auto-selects.
  const isShiprocket = carrier === "shiprocket"
  const [ratesRequested, setRatesRequested] = useState(false)
  const [rateWeight, setRateWeight] = useState<number | undefined>(undefined)
  const [rateDims, setRateDims] = useState<{
    lengthCm?: number
    widthCm?: number
    heightCm?: number
  }>({})
  const [selectedCourierId, setSelectedCourierId] = useState<
    string | number | undefined
  >(undefined)

  const {
    data: ratesData,
    isFetching: ratesLoading,
    error: ratesError,
  } = usePartnerShiprocketRates(
    orderId,
    { weightGrams: rateWeight, ...rateDims },
    { enabled: ratesRequested && isShiprocket && !existingAwb }
  )

  const numeric = (v: unknown) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : undefined
  }

  const handleGetRates = () => {
    // Quote against the weight AND dimensions typed in the parcel block, so the
    // estimate matches the parcel that will actually ship. Dimensions are not a
    // refinement on a cross-border quote — international couriers price on
    // volumetric weight and the size filters who will carry it at all, so a
    // quote without them can be far too cheap and list couriers that would
    // refuse the parcel.
    const values = form.getValues()
    setRateWeight(numeric(values.weight_grams))
    setRateDims({
      lengthCm: numeric(values.length_cm),
      widthCm: numeric(values.width_cm),
      heightCm: numeric(values.height_cm),
    })
    setSelectedCourierId(undefined)
    setRatesRequested(true)
  }

  const handleGenerate = async () => {
    try {
      // Parcel details drive the carrier's weight/dimension pricing and the
      // label. Form inputs are strings, so coerce; omitted/blank fields aren't
      // sent — the backend keeps its default weight rather than shipping a
      // zero-gram parcel. Dimensions are all-or-nothing (a partial box is
      // meaningless), matching the server-side rule.
      const pos = (v: unknown) => {
        const n = Number(v)
        return Number.isFinite(n) && n > 0 ? n : undefined
      }
      const values = form.getValues()
      const weight_grams = pos(values.weight_grams)
      const length = pos(values.length_cm)
      const width = pos(values.width_cm)
      const height = pos(values.height_cm)
      const dimensions_cm =
        length && width && height ? { length, width, height } : undefined

      const res = await generateLabel({
        carrier,
        weight_grams,
        dimensions_cm,
        // Only meaningful for Shiprocket; ignored by carriers that auto-assign.
        preferred_courier_id: isShiprocket ? selectedCourierId : undefined,
      })
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

          {/* Parcel details — drive the carrier's weight/dimension pricing and
              the printed label. Optional: left blank, the shipment uses the
              backend default weight (which is why labels used to ship at 500 g
              regardless of the parcel). */}
          {!existingAwb ? (
            <div className="flex flex-col gap-y-2 border-t pt-4">
              <Label size="xsmall">Parcel</Label>
              <Text size="small" className="text-ui-fg-subtle">
                Weight and box size price the shipment and print on the label.
                Leave blank to use the default weight.
              </Text>
              <div className="grid max-w-xs grid-cols-2 gap-2">
                <Input
                  type="number"
                  min={0}
                  placeholder="Weight (g)"
                  {...form.register("weight_grams")}
                />
              </div>
              <div className="grid max-w-xs grid-cols-3 gap-2">
                <Input
                  type="number"
                  min={0}
                  placeholder="L (cm)"
                  {...form.register("length_cm")}
                />
                <Input
                  type="number"
                  min={0}
                  placeholder="W (cm)"
                  {...form.register("width_cm")}
                />
                <Input
                  type="number"
                  min={0}
                  placeholder="H (cm)"
                  {...form.register("height_cm")}
                />
              </div>
            </div>
          ) : null}

          {/* Courier selection — Shiprocket only. Quote couriers by rate/ETA and
              pick one before generating; skipping this lets Shiprocket
              auto-select. Delhivery has no courier picker (it auto-assigns). */}
          {!existingAwb && isShiprocket ? (
            <div className="flex flex-col gap-y-2 border-t pt-4">
              <div className="flex items-center justify-between">
                <Label size="xsmall">Courier</Label>
                <Button
                  type="button"
                  variant="secondary"
                  size="small"
                  onClick={handleGetRates}
                  isLoading={ratesLoading}
                >
                  {ratesRequested ? "Refresh rates" : "Get courier rates"}
                </Button>
              </div>
              <Text size="small" className="text-ui-fg-subtle">
                Compare couriers by price and delivery estimate. Optional —
                leave it and Shiprocket picks the recommended courier.
              </Text>

              {ratesError ? (
                <Text size="small" className="text-ui-fg-error">
                  {(ratesError as any)?.message || "Couldn't load courier rates."}
                </Text>
              ) : null}

              {ratesRequested && !ratesLoading && ratesData ? (
                ratesData.rates?.length ? (
                  <div className="flex flex-col gap-y-2">
                    {ratesData.rates.map((r, i) => {
                      const id = r.courier_id ?? `rate-${i}`
                      const isSel = selectedCourierId === r.courier_id
                      return (
                        <button
                          type="button"
                          key={id}
                          onClick={() => setSelectedCourierId(r.courier_id)}
                          className={clx(
                            "flex items-center justify-between rounded-lg border px-3 py-2 text-left",
                            {
                              "border-ui-border-interactive bg-ui-bg-highlight":
                                isSel,
                              "border-ui-border-base hover:bg-ui-bg-subtle-hover":
                                !isSel,
                            }
                          )}
                        >
                          <div className="flex flex-col">
                            <div className="flex items-center gap-x-2">
                              <Text size="small" weight="plus">
                                {r.courier_name || `Courier ${id}`}
                              </Text>
                              {r.is_recommended ? (
                                <Badge size="2xsmall" color="green">
                                  Recommended
                                </Badge>
                              ) : null}
                            </div>
                            {r.estimated_days != null ? (
                              <Text size="xsmall" className="text-ui-fg-subtle">
                                Est. {r.estimated_days} day
                                {r.estimated_days === 1 ? "" : "s"}
                              </Text>
                            ) : null}
                          </div>
                          <Text size="small" weight="plus">
                            {r.currency_code?.toUpperCase()} {r.amount}
                          </Text>
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <Text size="small" className="text-ui-fg-subtle">
                    No couriers serviced this route. You can still generate a
                    label — Shiprocket will auto-assign.
                  </Text>
                )
              ) : null}
            </div>
          ) : null}

          <div>
            <Button
              type="button"
              variant="primary"
              onClick={handleGenerate}
              isLoading={isGenerating}
            >
              Generate {carrierLabel} label
              {selectedCourierId != null && isShiprocket
                ? " (selected courier)"
                : ""}
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

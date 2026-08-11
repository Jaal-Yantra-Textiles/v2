import {
  Badge,
  Button,
  Drawer,
  Heading,
  Input,
  Label,
  Select,
  Text,
  toast,
} from "@medusajs/ui"
import { useState } from "react"

import {
  useCreatePartnerGoodsTransfer,
  usePartnerGoodsTransfers,
  type GoodsTransfer,
} from "../../hooks/api/partner-goods-transfers"
import { useStockLocations } from "../../hooks/api/stock-locations"
import { extractErrorMessage } from "../../lib/extract-error-message"

/**
 * #891 — "Move to next location" on a completed production run.
 *
 * The run is where the goods physically are, and finishing one is the moment
 * its output either travels on (to an embroiderer, a QC or packaging warehouse)
 * or parks as stock. Until now the platform assumed finished goods were born at
 * the producing partner's location and stayed there forever, which quietly made
 * the customer leg's ship-from wrong the moment they moved.
 *
 * Only rendered for a completed run: before completion there is no output to
 * move, and offering the action earlier would invite a partner to ship a run
 * they haven't finished.
 */

const REASONS = [
  { value: "finishing", label: "Finishing / embroidery" },
  { value: "qc", label: "Quality check" },
  { value: "packaging", label: "Packaging" },
  { value: "stock", label: "Into stock" },
  { value: "customer", label: "On to the customer" },
  { value: "other", label: "Other" },
] as const

// Mirrors the backend's supported carriers. "No carrier" is a real choice, not
// an empty state: a van run between two of our own locations is a movement
// worth recording even though no carrier is involved.
//
// It carries the sentinel `NO_CARRIER` rather than "" because Radix reserves
// the empty string to mean "cleared, show the placeholder" and THROWS on a
// `<Select.Item value="">` — which took the whole "Move to next location"
// drawer down with a render error the moment it opened. The sentinel never
// leaves this component: `carrierValue()` maps it back to undefined on submit.
const NO_CARRIER = "none"

const CARRIERS = [
  { value: NO_CARRIER, label: "No carrier (self-driven)" },
  { value: "shiprocket", label: "Shiprocket" },
  { value: "delhivery", label: "Delhivery" },
] as const

/** Sentinel/blank → undefined, so the backend still sees "no carrier". */
const carrierValue = (v: string): string | undefined =>
  !v || v === NO_CARRIER ? undefined : v

const STATUS_COLOR: Record<
  GoodsTransfer["status"],
  "grey" | "blue" | "green" | "red"
> = {
  draft: "grey",
  in_transit: "blue",
  delivered: "green",
  cancelled: "red",
}

/** Empty → undefined, else a positive number (a blank must not become 0). */
const positive = (v: string): number | undefined => {
  if (!v.trim()) return undefined
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

type Props = {
  runId: string
  /** Only completed runs have output to move. */
  isCompleted: boolean
}

export const GoodsTransferSection = ({ runId, isCompleted }: Props) => {
  const [open, setOpen] = useState(false)
  const [toLocationId, setToLocationId] = useState("")
  const [reason, setReason] = useState<GoodsTransfer["reason"]>("stock")
  const [carrier, setCarrier] = useState<string>(NO_CARRIER)
  const [quantity, setQuantity] = useState("")
  const [weight, setWeight] = useState("")
  const [notes, setNotes] = useState("")

  const { data, isLoading } = usePartnerGoodsTransfers(runId, {
    enabled: isCompleted,
  })
  const transfers = data?.goods_transfers || []

  // Destinations the partner can pick. Cross-party hops (to another partner's
  // or a JYT warehouse) are admin-initiated for now — the partner store scope
  // doesn't see those locations.
  const { stock_locations: locations = [] } = useStockLocations(undefined, {
    enabled: isCompleted && open,
  } as any)

  const { mutateAsync: createTransfer, isPending } =
    useCreatePartnerGoodsTransfer(runId)

  const locationName = (id?: string | null) =>
    locations.find((l: any) => l.id === id)?.name || id || "—"

  const handleSubmit = async () => {
    if (!toLocationId) return
    try {
      const res = await createTransfer({
        to_location_id: toLocationId,
        reason,
        carrier: carrierValue(carrier),
        quantity: positive(quantity),
        weight_grams: positive(weight),
        notes: notes.trim() || undefined,
      })
      const t = res.goods_transfer
      toast.success(
        t.awb
          ? `Transfer booked — AWB ${t.awb}`
          : "Transfer recorded (no carrier booked)"
      )
      setOpen(false)
      setToLocationId("")
      setCarrier(NO_CARRIER)
      setNotes("")
      setQuantity("")
      setWeight("")
    } catch (e) {
      toast.error(extractErrorMessage(e))
    }
  }

  if (!isCompleted) return null

  return (
    <div className="flex flex-col gap-y-3 border-t px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-x-2">
          <Heading level="h3">Goods movement</Heading>
          {transfers.length > 0 && (
            <Badge size="2xsmall">{transfers.length}</Badge>
          )}
        </div>
        <Button size="small" variant="secondary" onClick={() => setOpen(true)}>
          Move to next location
        </Button>
      </div>

      {isLoading ? null : transfers.length === 0 ? (
        <Text size="small" className="text-ui-fg-subtle">
          This run's output hasn't moved. Record where it goes next — a
          finishing or QC partner, a packaging warehouse, or into stock — so the
          customer leg ships from where the goods actually are.
        </Text>
      ) : (
        <div className="flex flex-col gap-y-2">
          {transfers.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between gap-x-3"
            >
              <Text size="small">
                {t.quantity} × → {locationName(t.to_location_id)}
                <span className="text-ui-fg-subtle"> · {t.reason}</span>
              </Text>
              <Badge size="2xsmall" color={STATUS_COLOR[t.status]}>
                {t.status.replace("_", " ")}
              </Badge>
            </div>
          ))}
        </div>
      )}

      <Drawer open={open} onOpenChange={setOpen}>
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>Move goods to the next location</Drawer.Title>
          </Drawer.Header>
          <Drawer.Body className="flex flex-col gap-y-4 overflow-y-auto">
            <div className="flex flex-col gap-y-1">
              <Label size="small">Destination</Label>
              <Select value={toLocationId} onValueChange={setToLocationId}>
                <Select.Trigger>
                  <Select.Value placeholder="Select a location" />
                </Select.Trigger>
                <Select.Content>
                  {locations.map((l: any) => (
                    <Select.Item key={l.id} value={l.id}>
                      {l.name}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </div>

            <div className="flex flex-col gap-y-1">
              <Label size="small">Reason</Label>
              <Select
                value={reason}
                onValueChange={(v) => setReason(v as GoodsTransfer["reason"])}
              >
                <Select.Trigger>
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  {REASONS.map((r) => (
                    <Select.Item key={r.value} value={r.value}>
                      {r.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </div>

            <div className="flex flex-col gap-y-1">
              <Label size="small">Carrier</Label>
              <Select value={carrier} onValueChange={setCarrier}>
                <Select.Trigger>
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  {CARRIERS.map((c) => (
                    <Select.Item key={c.value} value={c.value}>
                      {c.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
              <Text size="xsmall" className="text-ui-fg-subtle">
                Booking a carrier generates an AWB and label from the source
                location's registered pickup.
              </Text>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-y-1">
                <Label size="small">Units</Label>
                <Input
                  type="number"
                  min={1}
                  placeholder="All produced"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-y-1">
                <Label size="small">Weight (g)</Label>
                <Input
                  type="number"
                  min={1}
                  placeholder="500"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-col gap-y-1">
              <Label size="small">Notes</Label>
              <Input
                placeholder="Optional"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </Drawer.Body>
          <Drawer.Footer>
            <Button
              variant="secondary"
              size="small"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="small"
              isLoading={isPending}
              disabled={!toLocationId}
              onClick={handleSubmit}
            >
              {carrier ? "Book & move" : "Record movement"}
            </Button>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer>
    </div>
  )
}

export default GoodsTransferSection

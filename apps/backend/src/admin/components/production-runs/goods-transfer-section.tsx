import {
  Badge,
  Button,
  Drawer,
  Heading,
  Input,
  Label,
  Prompt,
  Select,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { HandTruck, Trash, TruckFast, XCircle } from "@medusajs/icons"
import { useState } from "react"

import { ActionMenu, type Action } from "../common/action-menu"
import {
  useCancelGoodsTransfer,
  useCreateGoodsTransfer,
  useDeleteGoodsTransfer,
  useGoodsTransfers,
  type AdminGoodsTransfer,
} from "../../hooks/api/goods-transfers"
import { useStockLocations } from "../../hooks/api/stock_location"
import { SHIPMENT_CARRIERS } from "../../lib/shipment-carriers"
import {
  describeTransferCarrier,
  describeTransferMovement,
} from "../../lib/transfer-carrier-line"

/**
 * Goods movement on a production run, for the ADMIN (#891 follow-up).
 *
 * The routes have existed since #891 S1 and only partner-ui ever grew a
 * surface, so every admin transfer so far — including the live
 * Shramdaan → Dharamshala hop — was booked by hand against the API. That is
 * tolerable for a verification run and useless in an incident: when the carrier
 * cancelled that waybill, the row went on saying `in_transit` and there was no
 * screen on which anyone could say otherwise.
 *
 * What this adds beyond the partner section it mirrors:
 *
 * · **Record a carrier cancellation.** A booked hop can be marked cancelled
 *   when the carrier has already voided the AWB. It does NOT call the carrier —
 *   the copy says so, because an operator who believed it did would stop
 *   chasing them.
 * · **Re-book, keeping the history.** A cancelled hop can be re-created as a
 *   NEW transfer that points back at it. Nothing is edited and nothing is
 *   deleted: the first attempt really happened, and this list is the only
 *   record of what physically moved.
 */

const REASONS = [
  { value: "finishing", label: "Finishing / embroidery" },
  { value: "qc", label: "Quality check" },
  { value: "packaging", label: "Packaging" },
  { value: "stock", label: "Into stock" },
  { value: "customer", label: "On to the customer" },
  { value: "other", label: "Other" },
] as const

/**
 * "No carrier" is a real choice, not an empty state: a van run between two of
 * our own locations is a movement worth recording.
 *
 * ⚠️ The sentinel exists because Radix reserves the empty string for "cleared"
 * and THROWS on `<Select.Item value="">` — which took the whole partner drawer
 * down with a render error the moment it opened. It never leaves this component.
 */
const NO_CARRIER = "none"

const CARRIERS = [
  { value: NO_CARRIER, label: "No carrier (self-driven)" },
  ...SHIPMENT_CARRIERS.map((c) => ({ value: c.value, label: c.label })),
]

const carrierValue = (v: string): string | undefined =>
  !v || v === NO_CARRIER ? undefined : v

const STATUS_COLOR: Record<
  AdminGoodsTransfer["status"],
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

const errorMessage = (e: any): string =>
  e?.message || e?.response?.data?.message || "Something went wrong"

type Props = {
  runId: string
}

export const GoodsTransferSection = ({ runId }: Props) => {
  const [open, setOpen] = useState(false)
  const [toLocationId, setToLocationId] = useState("")
  const [reason, setReason] = useState<AdminGoodsTransfer["reason"]>("stock")
  const [carrier, setCarrier] = useState<string>(NO_CARRIER)
  const [quantity, setQuantity] = useState("")
  const [weight, setWeight] = useState("")
  const [notes, setNotes] = useState("")
  /** Set when the drawer was opened via "Re-book" on a cancelled hop. */
  const [replacing, setReplacing] = useState<AdminGoodsTransfer | null>(null)
  /**
   * "Record a movement that already happened" — the same drawer with the
   * carrier question removed rather than merely defaulted.
   *
   * 🔴 It is not cosmetic. A carrier booking mints a REAL, billable Delhivery
   * waybill and there is no sandbox, so the one affordance that can spend money
   * should be absent from the flow whose whole premise is that the goods have
   * already moved. A select that merely starts on "no carrier" is one stray
   * click from a booking nobody meant to make (#1542).
   */
  const [recordOnly, setRecordOnly] = useState(false)

  const [cancelling, setCancelling] = useState<AdminGoodsTransfer | null>(null)
  const [cancelReason, setCancelReason] = useState("")
  /** The "clear abandoned drafts" confirmation. */
  const [clearingDrafts, setClearingDrafts] = useState(false)
  const [isClearing, setIsClearing] = useState(false)

  const { goods_transfers: transfers = [], isLoading } = useGoodsTransfers(runId)
  /**
   * 🔴 This was `enabled: open` — the locations were only fetched once the
   * drawer had been opened, and `locationName` falls back to the raw id. So the
   * list a page-load lands on read
   * "4 × sloc_01K2… → sloc_01K3…" until you happened to open the drawer, after
   * which it silently became readable and stayed that way.
   *
   * Nothing failed and nothing logged, which is why it survived #1541: the
   * interface was proven to compile and its API path proven by curl, and this
   * is visible only to an eye on the screen. It is also needed unconditionally
   * now — the "clear abandoned drafts" prompt names each row by location.
   */
  const { stock_locations: locations = [] } = useStockLocations(undefined, {
    enabled: !!runId,
  } as any)

  const { mutateAsync: createTransfer, isPending: isCreating } =
    useCreateGoodsTransfer(runId)
  const { mutateAsync: cancelTransfer, isPending: isCancelling } =
    useCancelGoodsTransfer(runId)
  const { mutateAsync: deleteDraft, isPending: isDeleting } =
    useDeleteGoodsTransfer(runId)

  const locationName = (id?: string | null) =>
    locations.find((l: any) => l.id === id)?.name || id || "—"

  const resetForm = () => {
    setToLocationId("")
    setReason("stock")
    setCarrier(NO_CARRIER)
    setQuantity("")
    setWeight("")
    setNotes("")
    setReplacing(null)
    setRecordOnly(false)
  }

  /**
   * Prefill from the hop being replaced. The destination, reason and quantity
   * are what the operator already decided once; making them retype it is how a
   * re-booking quietly becomes a DIFFERENT movement.
   *
   * The carrier is deliberately NOT prefilled. The last booking is the one that
   * just failed, and a carrier chosen by default is a carrier nobody chose.
   */
  const openReplacement = (t: AdminGoodsTransfer) => {
    setToLocationId(t.to_location_id ?? "")
    setReason(t.reason)
    setQuantity(t.quantity ? String(t.quantity) : "")
    setWeight("")
    setNotes(t.notes ?? "")
    setCarrier(NO_CARRIER)
    setReplacing(t)
    setRecordOnly(false)
    setOpen(true)
  }

  const openMovement = (opts?: { recordOnly?: boolean }) => {
    resetForm()
    setRecordOnly(!!opts?.recordOnly)
    setOpen(true)
  }

  /** Drafts are the only rows that can be cleared — nothing was ever booked. */
  const drafts = transfers.filter((t) => t.status === "draft")

  /**
   * Clear every abandoned draft in one go.
   *
   * The #891 run carries four of these from 9 Aug. Each is a hop somebody
   * planned and never booked, and one-at-a-time is the only way to be rid of
   * them today — so in practice nobody is, and the section reads as if five
   * movements are pending when one is.
   *
   * Sequential rather than `Promise.all`: each delete invalidates the same
   * query, and a partial failure must leave a count the operator can act on
   * rather than a rejected batch that says nothing about which rows survived.
   */
  const handleClearDrafts = async () => {
    setIsClearing(true)
    let cleared = 0
    let failed = 0
    for (const draft of drafts) {
      try {
        await deleteDraft(draft.id)
        cleared++
      } catch {
        failed++
      }
    }
    setIsClearing(false)
    setClearingDrafts(false)
    if (failed) {
      toast.error(
        `Cleared ${cleared}, but ${failed} could not be cancelled. Reload and try again.`
      )
    } else {
      toast.success(`Cleared ${cleared} abandoned draft${cleared === 1 ? "" : "s"}`)
    }
  }

  const handleSubmit = async () => {
    if (!toLocationId) return
    try {
      const res = await createTransfer({
        to_location_id: toLocationId,
        reason,
        // 🔑 recordOnly wins over the state: the select is not rendered, so
        // `carrier` still holds whatever a previous open left there.
        carrier: recordOnly ? undefined : carrierValue(carrier),
        quantity: positive(quantity),
        weight_grams: positive(weight),
        notes: notes.trim() || undefined,
        replaces_transfer_id: replacing?.id,
      })
      const t = (res as any).goods_transfer
      toast.success(
        t?.awb
          ? `Transfer booked — AWB ${t.awb}`
          : "Transfer recorded (no carrier booked)"
      )
      setOpen(false)
      resetForm()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const handleCancel = async () => {
    if (!cancelling) return
    const isBooked = cancelling.status !== "draft"
    try {
      if (isBooked) {
        await cancelTransfer({
          transferId: cancelling.id,
          carrier_cancelled: true,
          reason: cancelReason.trim() || undefined,
        })
      } else {
        await deleteDraft(cancelling.id)
      }
      toast.success(
        isBooked ? "Recorded as cancelled by the carrier" : "Draft cancelled"
      )
      setCancelling(null)
      setCancelReason("")
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="flex flex-col gap-y-3 border-t px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-x-2">
          <Heading level="h3">Goods movement</Heading>
          {transfers.length > 0 && <Badge size="2xsmall">{transfers.length}</Badge>}
        </div>
        <ActionMenu
          groups={[
            {
              actions: [
                {
                  icon: <TruckFast />,
                  label: "Move to next location",
                  onClick: () => openMovement(),
                },
                {
                  icon: <HandTruck />,
                  label: "Record a movement that already happened",
                  onClick: () => openMovement({ recordOnly: true }),
                },
              ],
            },
            {
              actions: [
                {
                  icon: <Trash />,
                  label: drafts.length
                    ? `Clear ${drafts.length} abandoned draft${
                        drafts.length === 1 ? "" : "s"
                      }`
                    : "Clear abandoned drafts",
                  disabled: !drafts.length,
                  disabledTooltip: "No planned-but-unbooked hops to clear.",
                  onClick: () => setClearingDrafts(true),
                },
              ],
            },
          ]}
        />
      </div>

      {isLoading ? null : transfers.length === 0 ? (
        <Text size="small" className="text-ui-fg-subtle">
          This run's output hasn't moved. Record where it goes next — a
          finishing or QC partner, a packaging warehouse, or into stock — so the
          customer leg ships from where the goods actually are.
        </Text>
      ) : (
        <div className="flex flex-col gap-y-2">
          {transfers.map((t) => {
            const replacedBy = t.metadata?.replaced_by_transfer_id
            const replaces = t.metadata?.replaces_transfer_id
            const carrier = describeTransferCarrier(t)
            const movement = describeTransferMovement(t)

            const rowActions: Action[] = []
            if (t.status === "cancelled" && !replacedBy) {
              rowActions.push({
                icon: <TruckFast />,
                label: "Re-book this movement",
                onClick: () => openReplacement(t),
              })
            }
            if (t.status === "draft" || t.status === "in_transit") {
              rowActions.push({
                icon: t.status === "draft" ? <Trash /> : <XCircle />,
                label:
                  t.status === "draft"
                    ? "Cancel this planned hop"
                    : "Record as cancelled by the carrier",
                onClick: () => {
                  setCancelling(t)
                  setCancelReason("")
                },
              })
            }

            return (
              <div key={t.id} className="flex flex-col gap-y-1">
                <div className="flex items-center justify-between gap-x-3">
                  <Text size="small">
                    {t.quantity} × {locationName(t.from_location_id)} →{" "}
                    {locationName(t.to_location_id)}
                    <span className="text-ui-fg-subtle"> · {t.reason}</span>
                  </Text>
                  <div className="flex items-center gap-x-2">
                    <Badge size="2xsmall" color={STATUS_COLOR[t.status]}>
                      {t.status.replace("_", " ")}
                    </Badge>
                    {/* Only rendered when there is something to do — an empty
                        "⋯" that opens onto nothing reads as a broken control. */}
                    {rowActions.length > 0 && (
                      <ActionMenu groups={[{ actions: rowActions }]} />
                    )}
                  </div>
                </div>
                {/* The waybill, which used to exist only in the booking toast
                    (#1553). Dismiss that and the operator's next question —
                    "has it been picked up?" — had no answer on this screen. */}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Text
                    size="xsmall"
                    className={
                      carrier.muted ? "text-ui-fg-muted" : "text-ui-fg-subtle"
                    }
                  >
                    {carrier.text}
                  </Text>
                  {carrier.trackingUrl && (
                    <a
                      href={carrier.trackingUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-ui-fg-interactive text-xs hover:underline"
                    >
                      Track
                    </a>
                  )}
                  {carrier.labelUrl && (
                    <a
                      href={carrier.labelUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-ui-fg-interactive text-xs hover:underline"
                    >
                      Label
                    </a>
                  )}
                  {movement && (
                    <Text size="xsmall" className="text-ui-fg-muted">
                      {movement}
                    </Text>
                  )}
                </div>
                {/* The history the re-booking preserves, said out loud. */}
                {(replaces || replacedBy || t.notes) && (
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    {replaces && `Re-booking of ${replaces}. `}
                    {replacedBy && `Replaced by ${replacedBy}. `}
                    {t.notes}
                  </Text>
                )}
              </div>
            )
          })}
        </div>
      )}

      <Drawer
        open={open}
        onOpenChange={(v) => {
          setOpen(v)
          if (!v) resetForm()
        }}
      >
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>
              {replacing
                ? "Re-book this movement"
                : recordOnly
                  ? "Record a movement that already happened"
                  : "Move goods to the next location"}
            </Drawer.Title>
          </Drawer.Header>
          {/* ⚠️ overflow-y-auto: a modal body without it does not scroll, and the
              footer buttons become unreachable on a short viewport. */}
          <Drawer.Body className="flex flex-col gap-y-4 overflow-y-auto">
            {replacing && (
              <Text size="small" className="text-ui-fg-subtle">
                Replaces <strong>{replacing.id}</strong>, which stays on the run
                as the record that the first attempt happened. The two will link
                to each other.
              </Text>
            )}

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
                onValueChange={(v) => setReason(v as AdminGoodsTransfer["reason"])}
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

            {recordOnly ? (
              <Text size="xsmall" className="text-ui-fg-subtle">
                No carrier will be contacted and no waybill booked — this records
                a movement that has already happened. To book a courier, close
                this and choose <strong>Move to next location</strong> instead.
              </Text>
            ) : (
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
                  Booking a carrier generates a REAL, billable waybill from the
                  source location's registered pickup. Leave it on "no carrier"
                  for a self-driven hop or a dry run.
                </Text>
              </div>
            )}

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
            <Button variant="secondary" size="small" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button
              size="small"
              isLoading={isCreating}
              disabled={!toLocationId}
              onClick={handleSubmit}
            >
              {!recordOnly && carrierValue(carrier)
                ? "Book & move"
                : "Record movement"}
            </Button>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer>

      <Prompt open={!!cancelling} onOpenChange={(v) => !v && setCancelling(null)}>
        <Prompt.Content>
          <Prompt.Header>
            <Prompt.Title>
              {cancelling?.status === "draft"
                ? "Cancel this planned hop?"
                : "Record this as cancelled?"}
            </Prompt.Title>
            <Prompt.Description>
              {cancelling?.status === "draft"
                ? "Nothing was booked, so nothing is being undone. The row stays as the record that a hop was planned and abandoned."
                : "This marks the row cancelled. It does NOT cancel the waybill with the carrier — do that in their dashboard first, or the shipment keeps travelling while this says it stopped."}
            </Prompt.Description>
          </Prompt.Header>
          {cancelling?.status !== "draft" && (
            <div className="flex flex-col gap-y-1 px-6 pb-4">
              <Label size="small">Why (kept on the record)</Label>
              <Textarea
                placeholder="e.g. Delhivery cancelled the waybill at their end"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
            </div>
          )}
          <Prompt.Footer>
            <Prompt.Cancel>Keep it</Prompt.Cancel>
            <Prompt.Action
              onClick={handleCancel}
              disabled={isCancelling || isDeleting}
            >
              Cancel the transfer
            </Prompt.Action>
          </Prompt.Footer>
        </Prompt.Content>
      </Prompt>
      <Prompt
        open={clearingDrafts}
        onOpenChange={(v) => !v && setClearingDrafts(false)}
      >
        <Prompt.Content>
          <Prompt.Header>
            <Prompt.Title>
              Clear {drafts.length} abandoned draft
              {drafts.length === 1 ? "" : "s"}?
            </Prompt.Title>
            <Prompt.Description>
              These hops were planned and never booked, so nothing is being
              undone with a carrier. Each row is marked cancelled and stays on
              the run as the record that a movement was planned and abandoned.
            </Prompt.Description>
          </Prompt.Header>
          {/* Named, not just counted — "clear 4 drafts" is a number, and the
              operator is agreeing to specific rows. */}
          <div className="flex flex-col gap-y-1 px-6 pb-4">
            {drafts.map((d) => (
              <Text key={d.id} size="xsmall" className="text-ui-fg-subtle">
                {d.quantity} × {locationName(d.from_location_id)} →{" "}
                {locationName(d.to_location_id)} · {d.reason}
              </Text>
            ))}
          </div>
          <Prompt.Footer>
            <Prompt.Cancel>Keep them</Prompt.Cancel>
            <Prompt.Action onClick={handleClearDrafts} disabled={isClearing}>
              Clear them
            </Prompt.Action>
          </Prompt.Footer>
        </Prompt.Content>
      </Prompt>
    </div>
  )
}

export default GoodsTransferSection

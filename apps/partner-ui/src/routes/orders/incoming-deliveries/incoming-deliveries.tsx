import { Badge, Button, Container, Heading, Switch, Text } from "@medusajs/ui"
import { useState } from "react"
import { Link } from "react-router-dom"

import { SingleColumnPage } from "../../../components/layout/pages"
import { useExtension } from "../../../providers/extension-provider"
import {
  IncomingDelivery,
  usePartnerIncomingDeliveries,
} from "../../../hooks/api/partner-incoming-deliveries"

/**
 * Orders → Incoming deliveries (#2286).
 *
 * Goods on their way to (or already at) this partner's warehouse, whoever
 * supplies them. The partner confirms what actually arrived, line by line —
 * that confirmation is what puts the goods on the books. A courier marking a
 * parcel "Delivered" does not.
 *
 * `hasOutlet`: the confirm form mounts as a child route in a focus modal.
 */
const fmt = (n: number) => String(Math.round((Number(n) || 0) * 1000) / 1000)
const date = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : "—")

export const IncomingDeliveries = () => {
  const { getWidgets } = useExtension()
  const [showAll, setShowAll] = useState(false)
  const { incoming_deliveries, location_id, isPending, isError, error } =
    usePartnerIncomingDeliveries({ all: showAll })

  if (isError) throw error

  return (
    <SingleColumnPage
      widgets={{
        before: getWidgets("incoming_delivery.list.before" as any),
        after: getWidgets("incoming_delivery.list.after" as any),
      }}
      hasOutlet
    >
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading>Incoming deliveries</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Materials sent to your warehouse. Confirm what actually arrived so it shows in your stock.
            </Text>
          </div>
          <div className="flex items-center gap-x-2">
            <Switch id="show-all" checked={showAll} onCheckedChange={setShowAll} />
            <label htmlFor="show-all" className="txt-small text-ui-fg-base">
              Show received
            </label>
          </div>
        </div>

        {isPending ? (
          <div className="px-6 py-4">
            <Text size="small" className="text-ui-fg-subtle">Loading…</Text>
          </div>
        ) : !location_id ? (
          <div className="px-6 py-4">
            <Text size="small" className="text-ui-fg-subtle">
              No warehouse is set up for your account yet, so nothing can be delivered to you here. Please contact JYT.
            </Text>
          </div>
        ) : !incoming_deliveries.length ? (
          <div className="px-6 py-4">
            <Text size="small" className="text-ui-fg-subtle">
              {showAll ? "No deliveries to your warehouse yet." : "Nothing waiting to be confirmed."}
            </Text>
          </div>
        ) : (
          incoming_deliveries.map((d) => <DeliveryRow key={d.id} delivery={d} />)
        )}
      </Container>
    </SingleColumnPage>
  )
}

const statusBadge = (d: IncomingDelivery) => {
  if (d.fully_received) return <Badge color="green" size="2xsmall">Received</Badge>
  if (d.cannot_confirm_reason === "not_dispatched")
    return <Badge color="grey" size="2xsmall">Not dispatched yet</Badge>
  if (d.lines.some((l) => l.received > 0))
    return <Badge color="orange" size="2xsmall">Partly received</Badge>
  return <Badge color="blue" size="2xsmall">{d.status}</Badge>
}

const DeliveryRow = ({ delivery: d }: { delivery: IncomingDelivery }) => (
  <div className="px-6 py-4">
    <div className="flex items-start justify-between gap-x-4">
      <div className="flex flex-col gap-y-1">
        <div className="flex items-center gap-x-2">
          <Text size="small" weight="plus">{d.from ? `From ${d.from}` : "Incoming delivery"}</Text>
          {statusBadge(d)}
          {d.is_sample && <Badge size="2xsmall">Sample</Badge>}
        </div>
        <Text size="xsmall" className="text-ui-fg-subtle">
          {d.invoice_number ? `Invoice ${d.invoice_number} · ` : ""}Ordered {date(d.order_date)} · Expected {date(d.expected_delivery_date)}
        </Text>
      </div>
      {d.can_confirm && (
        <Button size="small" asChild>
          <Link to={`${d.id}/receive`}>Confirm receipt</Link>
        </Button>
      )}
    </div>
    <div className="mt-3 grid grid-cols-[1fr_auto_auto_auto] gap-x-6 gap-y-1">
      <Text size="xsmall" className="text-ui-fg-muted">Material</Text>
      <Text size="xsmall" className="text-ui-fg-muted text-right">Ordered</Text>
      <Text size="xsmall" className="text-ui-fg-muted text-right">Received</Text>
      <Text size="xsmall" className="text-ui-fg-muted text-right">Still to come</Text>
      {d.lines.map((l) => (
        <div key={l.id} className="contents">
          <Text size="small">{l.name ?? l.id}</Text>
          <Text size="small" className="text-right">{fmt(l.ordered)} {l.unit ?? ""}</Text>
          <Text size="small" className="text-right">{fmt(l.received)}</Text>
          <Text size="small" className="text-right">{fmt(l.outstanding)}</Text>
        </div>
      ))}
    </div>
  </div>
)

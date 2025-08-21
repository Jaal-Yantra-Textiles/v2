import { Container, Heading, Text, StatusBadge, Table } from "@medusajs/ui"
import { redirect } from "next/navigation"
import { getPartnerInventoryOrder, partnerStartInventoryOrder, partnerCompleteInventoryOrder } from "../../actions"
import OrderDetailsTable from "./order-details-table"
import ActionFooter from "../../../components/action-footer/action-footer"
import ActionFormButton from "../../../components/action-footer/action-form-button"
import CompletionOrderEntry from "../../../components/completion/completion-order-entry"


interface PageProps {
  params: Promise<{ id: string }>
}

export const dynamic = "force-dynamic"

type LineFulfillment = { quantity_delta?: number | null }
type PartnerOrderLine = {
  id: string
  quantity: number
  line_fulfillments?: LineFulfillment[]
  // optional fields present on the API payload; used for display label
  inventory_item_id?: string
  inventory_items?: { title?: string | null }[]
}
type AdminNote = { note?: string }

export default async function InventoryOrderDetailsPage({ params }: PageProps) {
  const { id } = await params
  const order = await getPartnerInventoryOrder(id)

  if (!order) {
    // Fallback to list if not found
    redirect("/dashboard/inventory-orders")
  }

  async function startOrder() {
    "use server"
    await partnerStartInventoryOrder(id)
    redirect(`/dashboard/inventory-orders/${id}`)
  }
  async function completeOrderFromForm(formData: FormData) {
    "use server"
    // Build lines purely from submitted form data to avoid closing over `order`
    const lines: { order_line_id: string; quantity: number }[] = []
    for (const [key, value] of formData.entries()) {
      if (typeof key === "string" && key.startsWith("qty_")) {
        const id = key.slice(4)
        const v = Number(value as string)
        let delivered = Number.isFinite(v) && v >= 0 ? v : NaN
        if (!Number.isFinite(delivered)) {
          const requested = Number(formData.get(`requested_${id}`))
          delivered = Number.isFinite(requested) ? requested : 0
        }
        lines.push({ order_line_id: id, quantity: delivered })
      }
    }
    // Trim lines to only send positive quantities; omitted/zero treated as 0 for this shipment
    const trimmed = lines.filter((ln) => Number.isFinite(ln.quantity) && ln.quantity > 0)
    if (trimmed.length === 0) {
      // UI should prevent this, but guard to satisfy API requirement (non-empty lines)
      throw new Error("Please provide at least one line with quantity greater than 0.")
    }
    const notesInput = (formData.get("notes") as string) || ""
    // Determine if all lines are fully fulfilled
    const isFull = trimmed.every((ln) => {
      const requested = Number(formData.get(`requested_${ln.order_line_id}`))
      return Number.isFinite(requested) && requested === ln.quantity
    })
    const notes = notesInput.trim().length > 0
      ? notesInput
      : (isFull ? "Add Notes" : "Delivered half due to shortage")
    const deliveryDate = (formData.get("deliveryDate") as string) || undefined
    const tracking_number = (formData.get("tracking_number") as string) || undefined

    await partnerCompleteInventoryOrder(id, {
      notes,
      deliveryDate, // API accepts deliveryDate or delivery_date
      tracking_number,
      lines: trimmed,
    })
    redirect(`/dashboard/inventory-orders/${id}`)
  }
  const partnerStatus: string = order?.partner_info?.partner_status || "assigned"
  const shortId = order.id && order.id.length > 12 ? `${order.id.slice(0, 10)}…${order.id.slice(-4)}` : order.id
  const allFulfilled = Array.isArray(order.order_lines)
    ? (order.order_lines as PartnerOrderLine[]).every((l) => {
        const requested = Number(l.quantity) || 0
        const fulfilled = Array.isArray(l.line_fulfillments)
          ? l.line_fulfillments.reduce((sum: number, f: LineFulfillment) => sum + (Number(f?.quantity_delta) || 0), 0)
          : 0
        return fulfilled >= requested && requested > 0
      })
    : false
  
  return (
    <>
      <Container className="py-6 p-4 w-full !max-w-none">
        {/* Header */}
        <section aria-labelledby="order-header" className="mb-6 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <Heading id="order-header" level="h2" title={order.id} className="truncate">Order {shortId}</Heading>
            <Text size="small" className="text-ui-fg-subtle truncate">Assigned to {order.partner_info?.partner_name}</Text>
          </div>
          <div className="flex items-center gap-2 md:self-auto self-start">
            <StatusBadge color={partnerStatus === "completed" ? "green" : partnerStatus === "in_progress" ? "orange" : "blue"}>
              {partnerStatus}
            </StatusBadge>
          </div>
        </section>

        <section aria-labelledby="order-lines" className="mb-8">
          <Heading id="order-lines" level="h3" className="mb-2">Order Lines</Heading>
          {Array.isArray(order.order_lines) && order.order_lines.length > 0 ? (
            <OrderDetailsTable lines={order.order_lines} />
          ) : (
            <Text size="small" className="text-ui-fg-subtle">No order lines</Text>
          )}
        </section>

        <section aria-labelledby="workflow" className="mb-8">
          <Heading id="workflow" level="h3" className="mb-2">Workflow</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Tasks count: {order.partner_info?.workflow_tasks_count ?? 0}
          </Text>
        </section>

        <section aria-labelledby="admin-notes" className="mb-8">
          <Heading id="admin-notes" level="h3" className="mb-2">Admin Notes</Heading>
          {Array.isArray(order.admin_notes) && order.admin_notes.length > 0 ? (
            <ul className="list-disc pl-6">
              {(order.admin_notes as AdminNote[]).map((n: AdminNote, idx: number) => (
                <li key={idx}>
                  <Text size="small">{n?.note || JSON.stringify(n)}</Text>
                </li>
              ))}
            </ul>
          ) : (
            <Text size="small" className="text-ui-fg-subtle">No admin notes</Text>
          )}
        </section>
      </Container>

      <Container className="mt-6 py-6 pb-28 p-4 w-full !max-w-none">
        <section aria-labelledby="quantities-delivered" className="mb-8">
          <Heading id="quantities-delivered" level="h3" className="mb-2">Quantities Delivered</Heading>
          {Array.isArray(order.order_lines) && order.order_lines.length > 0 ? (
            <>
              {/* Desktop/tablet table */}
              <div className="hidden md:block overflow-x-auto rounded-md border border-ui-border-base">
                <Table>
                  <Table.Header>
                    <Table.Row>
                      <Table.HeaderCell>Item</Table.HeaderCell>
                      <Table.HeaderCell>Requested</Table.HeaderCell>
                      <Table.HeaderCell>Delivered</Table.HeaderCell>
                      <Table.HeaderCell>Remaining</Table.HeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {(order.order_lines as PartnerOrderLine[]).map((l) => {
                      const requested = Number(l.quantity) || 0
                      const delivered = Array.isArray(l.line_fulfillments)
                        ? l.line_fulfillments.reduce((sum: number, f: LineFulfillment) => sum + (Number(f?.quantity_delta) || 0), 0)
                        : 0
                      const remaining = Math.max(0, requested - delivered)
                      const shortId = l.id && l.id.length > 12 ? `${l.id.slice(0, 6)}…${l.id.slice(-4)}` : l.id
                      const label = (Array.isArray(l.inventory_items) && l.inventory_items[0]?.title) || l.inventory_item_id || shortId
                      return (
                        <Table.Row key={l.id}>
                          <Table.Cell className="max-w-[320px]">
                            <Text size="small" className="truncate" title={String(label)}>{label}</Text>
                          </Table.Cell>
                          <Table.Cell>
                            <Text size="small">{requested}</Text>
                          </Table.Cell>
                          <Table.Cell>
                            <Text size="small">{delivered}</Text>
                          </Table.Cell>
                          <Table.Cell>
                            <Text size="small">{remaining}</Text>
                          </Table.Cell>
                        </Table.Row>
                      )
                    })}
                  </Table.Body>
                </Table>
              </div>
              {/* Mobile cards */}
              <div className="md:hidden space-y-3">
                {(order.order_lines as PartnerOrderLine[]).map((l) => {
                  const requested = Number(l.quantity) || 0
                  const delivered = Array.isArray(l.line_fulfillments)
                    ? l.line_fulfillments.reduce((sum: number, f: LineFulfillment) => sum + (Number(f?.quantity_delta) || 0), 0)
                    : 0
                  const remaining = Math.max(0, requested - delivered)
                  const shortId = l.id && l.id.length > 12 ? `${l.id.slice(0, 6)}…${l.id.slice(-4)}` : l.id
                  const label = (Array.isArray(l.inventory_items) && l.inventory_items[0]?.title) || l.inventory_item_id || shortId
                  const progress = requested > 0 ? Math.min(100, Math.round((delivered / requested) * 100)) : 0
                  return (
                    <div key={l.id} className="rounded-md border border-ui-border-base p-3 bg-ui-bg-base">
                      <div className="text-sm font-medium truncate" title={String(label)}>{label}</div>
                      {/* Compact progress bar */}
                      <div className="mt-2 h-1.5 w-full bg-ui-bg-subtle rounded">
                        <div className="h-1.5 bg-ui-tag-blue rounded" style={{ width: `${progress}%` }} />
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                        <div className="rounded bg-ui-bg-subtle p-2">
                          <div className="text-[10px] text-ui-fg-muted">Requested</div>
                          <div className="text-sm">{requested}</div>
                        </div>
                        <div className="rounded bg-ui-bg-subtle p-2">
                          <div className="text-[10px] text-ui-fg-muted">Delivered</div>
                          <div className="text-sm">{delivered}</div>
                        </div>
                        <div className="rounded bg-ui-bg-subtle p-2">
                          <div className="text-[10px] text-ui-fg-muted">Remaining</div>
                          <div className="text-sm">
                            {remaining}
                            {remaining > 0 && (
                              <span className="ml-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] bg-ui-tag-orange text-ui-fg-on-color">left</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          ) : (
            <Text size="small" className="text-ui-fg-subtle">No order line quantities yet</Text>
          )}
        </section>
      </Container>

      <ActionFooter>
        {partnerStatus === "assigned" && (
          <ActionFormButton action={startOrder}>Start</ActionFormButton>
        )}
        {partnerStatus === "in_progress" && !allFulfilled && (
          <CompletionOrderEntry
            lines={(Array.isArray(order.order_lines) ? (order.order_lines as PartnerOrderLine[]) : []).map((l) => {
              const requested = Number(l.quantity) || 0
              const fulfilled = Array.isArray(l.line_fulfillments)
                ? l.line_fulfillments.reduce((sum: number, f: LineFulfillment) => sum + (Number(f?.quantity_delta) || 0), 0)
                : 0
              return { id: l.id, requested, fulfilled }
            })}
            action={completeOrderFromForm}
          />
        )}
        {(partnerStatus === "completed" || allFulfilled) && (
          <div className="w-full text-center">
            <Text size="small" className="text-ui-fg-subtle">
              It’s all good for now. If we need anything, we will be in touch.
            </Text>
          </div>
        )}
      </ActionFooter>
    </>
  )
}

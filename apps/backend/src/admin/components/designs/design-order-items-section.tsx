import { useState } from "react"
import {
  Badge,
  Button,
  Container,
  Heading,
  Select,
  StatusBadge,
  Text,
  toast,
  usePrompt,
} from "@medusajs/ui"

import {
  useChangeOrderItemDesign,
  type OrderItemRow,
  type OrderItemsSummary,
} from "../../hooks/api/design-orders"
import { useDesigns } from "../../hooks/api/designs"

/**
 * #1918 — the order's items: what was ordered, what arrived, and which design
 * each line stands for, with attach / detach.
 *
 * The page this sits on is routed on a CART line item, through a link that dies
 * at checkout. These rows come from the ORDER instead, which is the only side
 * that survives payment and the only side that can be re-pointed.
 *
 * Aline's order is the shape to keep in mind: 5 ordered, 1 delivered, 4 owed,
 * and three of those four cannot be edited at all because they carry no
 * variant. The uneditable reason is rendered rather than hidden — a disabled
 * control with no explanation reads as a bug.
 */

const stateColor = (
  state: OrderItemRow["state"]
): "green" | "blue" | "orange" | "grey" => {
  switch (state) {
    case "delivered":
      return "green"
    case "shipped":
      return "blue"
    case "made":
      return "orange"
    default:
      return "grey"
  }
}

export const DesignOrderItemsSection = ({
  summary,
  pageLineItemId,
}: {
  summary: OrderItemsSummary | null
  pageLineItemId: string
}) => {
  const prompt = usePrompt()
  const [editing, setEditing] = useState<string | null>(null)
  const [picked, setPicked] = useState<string>("")
  const { mutateAsync, isPending } = useChangeOrderItemDesign(pageLineItemId)
  // Only Approved/Commerce_Ready designs are offered — attaching a rejected or
  // in-development design to a paid line is not a thing anyone means to do.
  const { designs } = useDesigns({ limit: 100 })

  if (!summary) {
    return null
  }

  const change = async (
    row: OrderItemRow,
    designId: string | null,
    verb: string
  ) => {
    /**
     * Preview FIRST, then confirm with what the customer would actually be
     * told. The email's wording depends on whether the garment has a
     * production run, and an admin detaching a design deserves to see that
     * sentence before it is sent, not after.
     */
    let headline = ""
    try {
      const preview: any = await mutateAsync({
        order_line_item_id: row.id,
        design_id: designId,
        dry_run: true,
      })
      headline = preview?.notice?.headline ?? ""
    } catch {
      // A failed preview must not block the operation; it only costs the
      // admin the extra context in the dialog.
    }

    const confirmed = await prompt({
      title: `${verb} design`,
      description: [
        `${verb} the design on "${row.title ?? row.id}".`,
        row.state === "delivered"
          ? "⚠️ This line has already been DELIVERED. Changing its design does not change what the customer received."
          : "",
        headline ? `The customer will be told: "${headline}"` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      confirmText: verb,
      cancelText: "Cancel",
    })
    if (!confirmed) {
      return
    }

    try {
      await mutateAsync({ order_line_item_id: row.id, design_id: designId })
      setEditing(null)
      setPicked("")
      toast.success(`Design ${verb.toLowerCase()}ed. The customer has been told.`)
    } catch (e: any) {
      toast.error(e?.message ?? `Could not ${verb.toLowerCase()} the design`)
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          {/*
            NOT "Items" — the page already has a section by that name showing
            the CART's sibling lines. Two headings reading "Items" with
            different contents is a screen you cannot describe to someone.
          */}
          <Heading level="h2">Ordered &amp; delivered</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {summary.ordered_total} ordered · {summary.delivered_total} delivered
            {summary.has_outstanding
              ? ` · ${summary.outstanding_total} outstanding`
              : ""}
          </Text>
        </div>
        {/*
          Three states, not two. "Nothing outstanding" is not "everything
          arrived" — a made-but-undelivered line is neither, and rendering the
          boolean as a two-way choice printed "All delivered" over
          "0 delivered".
        */}
        <Badge
          color={
            summary.verdict === "owed"
              ? "orange"
              : summary.verdict === "all_delivered"
                ? "green"
                : "blue"
          }
        >
          {summary.verdict_label}
        </Badge>
      </div>

      {summary.items.map((row) => (
        <div key={row.id} className="px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Text weight="plus" className="truncate">
                  {row.title ?? row.id}
                </Text>
                <StatusBadge color={stateColor(row.state)}>
                  {row.state_label}
                </StatusBadge>
              </div>

              <Text size="small" className="text-ui-fg-subtle">
                Ordered {row.ordered ?? 0}
                {/* A never-tracked delivery is not the same as a known zero. */}
                {row.delivered === null
                  ? " · delivery not tracked"
                  : ` · delivered ${row.delivered}`}
              </Text>

              <div className="mt-1 flex flex-wrap items-center gap-2">
                {row.design ? (
                  <Badge size="2xsmall">
                    {row.design.name ?? row.design.id}
                  </Badge>
                ) : (
                  <Badge size="2xsmall" color="grey">
                    No design
                  </Badge>
                )}
                {/* Only worth showing when it disagrees with the current one. */}
                {row.original_design_id &&
                row.original_design_id !== row.design?.id ? (
                  <Text size="xsmall" className="text-ui-fg-muted">
                    ordered as {row.original_design_id}
                  </Text>
                ) : null}
                {row.design?.source === "metadata" ? (
                  <Text size="xsmall" className="text-ui-fg-muted">
                    (from provenance — not yet linked)
                  </Text>
                ) : null}
              </div>

              {!row.editable && row.uneditable_reason ? (
                <Text size="xsmall" className="text-ui-fg-muted mt-1">
                  {row.uneditable_reason}
                </Text>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {editing === row.id ? (
                <>
                  <Select value={picked} onValueChange={setPicked}>
                    <Select.Trigger className="w-48">
                      <Select.Value placeholder="Pick a design" />
                    </Select.Trigger>
                    <Select.Content>
                      {(designs ?? []).map((d: any) => (
                        <Select.Item key={d.id} value={d.id}>
                          {d.name}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select>
                  <Button
                    size="small"
                    disabled={!picked || isPending}
                    onClick={() => change(row, picked, "Attach")}
                  >
                    Save
                  </Button>
                  <Button
                    size="small"
                    variant="secondary"
                    onClick={() => {
                      setEditing(null)
                      setPicked("")
                    }}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    size="small"
                    variant="secondary"
                    onClick={() => {
                      setPicked(row.design?.id ?? "")
                      setEditing(row.id)
                    }}
                  >
                    {row.design ? "Change" : "Attach"}
                  </Button>
                  {row.design ? (
                    <Button
                      size="small"
                      variant="danger"
                      disabled={isPending}
                      onClick={() => change(row, null, "Detach")}
                    >
                      Detach
                    </Button>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>
      ))}
    </Container>
  )
}

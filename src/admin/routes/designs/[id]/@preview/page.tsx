import { useParams } from "react-router-dom"
import {
  Container,
  Heading,
  Text,
  Badge,
  StatusBadge,
  Skeleton,
  Avatar,
} from "@medusajs/ui"
import { useDesign, useDesignInventory, LinkedInventoryItem } from "../../../../hooks/api/designs"
import { RouteFocusModal } from "../../../../components/modal/route-focus-modal"

const statusColor = (status: string) => {
  switch (status) {
    case "Conceptual":
      return "grey"
    case "In_Development":
      return "orange"
    case "Technical_Review":
      return "purple"
    case "Sample_Production":
      return "orange"
    case "Revision":
      return "red"
    case "Approved":
      return "green"
    case "Commerce_Ready":
      return "green"
    case "Rejected":
      return "red"
    case "On_Hold":
      return "grey"
    default:
      return "grey"
  }
}

const priorityColor = (priority: string) => {
  switch (priority?.toLowerCase()) {
    case "high":
      return "red"
    case "medium":
      return "orange"
    case "low":
      return "blue"
    case "urgent":
      return "red"
    default:
      return "grey"
  }
}

const DesignPreviewPage = () => {
  const { id } = useParams<{ id: string }>()

  const { design, isLoading } = useDesign(id!, {
    fields: [
      "partners.*",
      "colors.*",
      "size_sets.*",
      "moodboard",
    ],
  })

  const { data: inventoryData, isLoading: inventoryLoading } = useDesignInventory(id!)
  const inventoryItems: LinkedInventoryItem[] = inventoryData?.inventory_items || []

  if (isLoading) {
    return (
      <RouteFocusModal>
        <RouteFocusModal.Header />
        <RouteFocusModal.Body className="flex flex-col items-center py-16">
          <Skeleton className="h-8 w-64 mb-4" />
          <Skeleton className="h-96 w-full max-w-4xl" />
        </RouteFocusModal.Body>
      </RouteFocusModal>
    )
  }

  if (!design) return null

  const partners = (design as any).partners || []

  // Extract moodboard thumbnail elements for read-only display
  const moodboard = design.moodboard as any
  const hasMoodboard = moodboard?.elements?.length > 0

  return (
    <RouteFocusModal>
      <RouteFocusModal.Header>
        <div className="flex items-center gap-x-3">
          <Heading className="text-ui-fg-base">Preview: {design.name}</Heading>
        </div>
      </RouteFocusModal.Header>
      <RouteFocusModal.Body className="flex flex-col gap-y-6 overflow-y-auto px-6 py-6">
        {/* Basic Details */}
        <Container className="divide-y p-0">
          <div className="flex items-center justify-between px-6 py-4">
            <Heading level="h2">Details</Heading>
            <div className="flex items-center gap-x-2">
              {design.priority && (
                <Badge color={priorityColor(design.priority)}>
                  {design.priority}
                </Badge>
              )}
              {design.status && (
                <StatusBadge color={statusColor(design.status)}>
                  {design.status.replace(/_/g, " ")}
                </StatusBadge>
              )}
            </div>
          </div>
          <div className="divide-y">
            <DetailRow label="Description" value={design.description || "-"} />
            <DetailRow label="Design Type" value={design.design_type || "-"} />
            <DetailRow
              label="Target Date"
              value={
                design.target_completion_date
                  ? new Date(design.target_completion_date).toLocaleDateString()
                  : "-"
              }
            />
            <DetailRow
              label="Estimated Cost"
              value={design.estimated_cost ? `$${design.estimated_cost}` : "-"}
            />
            {design.tags?.length ? (
              <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
                <Text size="small" leading="compact" weight="plus">
                  Tags
                </Text>
                <div className="flex flex-wrap gap-1">
                  {design.tags.map((tag, i) => (
                    <Badge key={i} size="2xsmall">{tag}</Badge>
                  ))}
                </div>
              </div>
            ) : null}
            {design.colors?.length ? (
              <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
                <Text size="small" leading="compact" weight="plus">
                  Colors
                </Text>
                <div className="flex flex-wrap gap-2">
                  {design.colors.map((color, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <div
                        className="size-4 rounded-full border border-ui-border-base"
                        style={{ backgroundColor: color.hex_code }}
                      />
                      <Text size="small">{color.name}</Text>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </Container>

        {/* Moodboard */}
        <Container className="p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Moodboard</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Visual inspiration board
            </Text>
          </div>
          <div className="px-6 pb-4">
            {hasMoodboard ? (
              <div className="rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {moodboard.elements
                    .filter((el: any) => el.type === "image" || el.type === "text")
                    .slice(0, 12)
                    .map((el: any, i: number) => {
                      if (el.type === "text") {
                        return (
                          <div
                            key={el.id || i}
                            className="rounded-md bg-ui-bg-base border border-ui-border-base p-3 flex items-center justify-center"
                          >
                            <Text size="small" className="text-center line-clamp-3">
                              {el.text}
                            </Text>
                          </div>
                        )
                      }
                      // For image elements, check if we have the file data
                      const fileId = el.fileId
                      const file = fileId && moodboard.files?.[fileId]
                      const dataURL = file?.dataURL
                      if (dataURL) {
                        return (
                          <div
                            key={el.id || i}
                            className="rounded-md border border-ui-border-base overflow-hidden aspect-square"
                          >
                            <img
                              src={dataURL}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          </div>
                        )
                      }
                      return null
                    })}
                </div>
                <Text className="text-ui-fg-muted mt-3" size="xsmall">
                  {moodboard.elements.length} element{moodboard.elements.length !== 1 ? "s" : ""} on canvas
                </Text>
              </div>
            ) : (
              <div className="flex items-center justify-center py-8">
                <Text className="text-ui-fg-subtle">No moodboard content</Text>
              </div>
            )}
          </div>
        </Container>

        {/* Inventory (read-only) */}
        <Container className="p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Inventory</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Inventory items linked to this design
            </Text>
          </div>
          {inventoryLoading ? (
            <div className="px-6 pb-4">
              <Skeleton className="h-16 w-full" />
            </div>
          ) : !inventoryItems.length ? (
            <div className="flex items-center justify-center py-4 pb-6">
              <Text className="text-ui-fg-subtle">No inventory items linked</Text>
            </div>
          ) : (
            <div className="flex flex-col gap-2 px-3 pb-4">
              {inventoryItems.map((item) => {
                const inv = (item.inventory_item || {}) as {
                  id?: string
                  title?: string
                  sku?: string
                }
                return (
                  <div
                    key={item.inventory_item_id || inv.id}
                    className="shadow-elevation-card-rest bg-ui-bg-component rounded-md px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex flex-1 flex-col">
                        <Text size="small" weight="plus">
                          {inv.title || item.inventory_item_id || "Inventory Item"}
                        </Text>
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          SKU: {inv.sku || "-"}
                        </Text>
                      </div>
                      {(item.planned_quantity != null || item.consumed_quantity != null) && (
                        <div className="flex gap-3 text-right">
                          {item.planned_quantity != null && (
                            <div>
                              <Text size="xsmall" className="text-ui-fg-muted">Planned</Text>
                              <Text size="small" weight="plus">{item.planned_quantity}</Text>
                            </div>
                          )}
                          {item.consumed_quantity != null && (
                            <div>
                              <Text size="xsmall" className="text-ui-fg-muted">Consumed</Text>
                              <Text size="small" weight="plus">{item.consumed_quantity}</Text>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Container>

        {/* Partners (read-only) */}
        <Container className="p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Partners</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Partners linked to this design
            </Text>
          </div>
          {!partners.length ? (
            <div className="flex items-center justify-center py-4 pb-6">
              <Text className="text-ui-fg-subtle">No partners linked</Text>
            </div>
          ) : (
            <div className="flex flex-col gap-2 px-3 pb-4">
              {partners.map((partner: any) => (
                <div
                  key={partner.id}
                  className="shadow-elevation-card-rest bg-ui-bg-component rounded-md px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <Avatar
                      src={partner.logo || undefined}
                      fallback={partner.name?.charAt(0) || "P"}
                    />
                    <div className="flex flex-1 flex-col">
                      <Text size="small" weight="plus">
                        {partner.name || `Partner ${partner.id}`}
                      </Text>
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        {partner.handle || "-"}
                      </Text>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Container>
      </RouteFocusModal.Body>
    </RouteFocusModal>
  )
}

const DetailRow = ({ label, value }: { label: string; value: string }) => (
  <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
    <Text size="small" leading="compact" weight="plus">
      {label}
    </Text>
    <Text size="small" leading="compact">
      {value}
    </Text>
  </div>
)

export default DesignPreviewPage

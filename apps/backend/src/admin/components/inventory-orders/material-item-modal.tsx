import { Eye } from "@medusajs/icons"
import {
  Badge,
  Button,
  IconButton,
  Text,
  Tooltip,
} from "@medusajs/ui"
import { InventoryItem, RawMaterial } from "../../hooks/api/raw-materials"
import { StackedFocusModal } from "../modal/stacked-modal/stacked-focused-modal"

interface MaterialItemModalTriggerProps {
  item?: (InventoryItem & { raw_materials?: RawMaterial | null }) | null
}

const InfoRow = ({
  label,
  value,
}: {
  label: string
  value?: string | number | null
}) => (
  <div className="flex flex-col gap-0.5">
    <Text size="xsmall" className="text-ui-fg-subtle uppercase tracking-wide">
      {label}
    </Text>
    <Text size="small">{value ?? "—"}</Text>
  </div>
)

const Divider = () => <div className="border-t border-ui-border-base" />

export const MaterialItemModalTrigger = ({
  item,
}: MaterialItemModalTriggerProps) => {
  if (!item) {
    return (
      <Tooltip content="Select an item first">
        <IconButton
          type="button"
          size="small"
          variant="transparent"
          disabled
        >
          <Eye />
          <span className="sr-only">View item details</span>
        </IconButton>
      </Tooltip>
    )
  }

  return (
    <StackedFocusModal id={`material-item-modal-${item.id}`}>
      <StackedFocusModal.Trigger asChild>
        <Tooltip content="View item details" side="left">
          <IconButton
            type="button"
            size="small"
            variant="transparent"
            className="text-ui-fg-muted hover:text-ui-fg-base"
          >
            <Eye />
            <span className="sr-only">View item details</span>
          </IconButton>
        </Tooltip>
      </StackedFocusModal.Trigger>

      <StackedFocusModal.Content className="flex h-[calc(100vh-3rem)] max-h-[calc(100vh-3rem)] flex-col">
        <StackedFocusModal.Header>
          <div className="flex flex-col gap-1">
            <Text size="small" className="text-ui-fg-subtle uppercase">
              Inventory Item
            </Text>
            <div className="flex flex-wrap items-center gap-2">
              <Text weight="plus" size="large">
                {item.title || "Untitled item"}
              </Text>
              {item.sku && (
                <Badge size="small" color="grey">
                  SKU: {item.sku}
                </Badge>
              )}
            </div>
          </div>
        </StackedFocusModal.Header>

        <StackedFocusModal.Body className="flex-1 overflow-y-auto px-6 py-4">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <Text size="small" className="text-ui-fg-subtle">
                {item.description || "No description provided."}
              </Text>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <InfoRow label="Material" value={item.material} />
                <InfoRow label="Weight" value={item.weight} />
                <InfoRow label="Dimensions" value={`${item.length ?? "—"} × ${item.width ?? "—"} × ${item.height ?? "—"}`} />
                <InfoRow label="Origin Country" value={item.origin_country} />
                <InfoRow label="HS Code" value={item.hs_code} />
                <InfoRow
                  label="Requires Shipping"
                  value={item.requires_shipping ? "Yes" : "No"}
                />
              </div>
            </div>

            {item.raw_materials && (
              <div className="flex flex-col gap-3">
                <Divider />
                <Text weight="plus">Raw Material</Text>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <InfoRow
                    label="Name"
                    value={item.raw_materials.name}
                  />
                  <InfoRow
                    label="Color"
                    value={item.raw_materials.color}
                  />
                  <InfoRow
                    label="Width"
                    value={item.raw_materials.width}
                  />
                  <InfoRow
                    label="Weight"
                    value={item.raw_materials.weight}
                  />
                  <InfoRow
                    label="Lead Time (days)"
                    value={
                      item.raw_materials.lead_time_days
                        ? String(item.raw_materials.lead_time_days)
                        : undefined
                    }
                  />
                  <InfoRow
                    label="Minimum Order Qty"
                    value={
                      item.raw_materials.minimum_order_quantity
                        ? String(item.raw_materials.minimum_order_quantity)
                        : undefined
                    }
                  />
                </div>
                {item.raw_materials.description && (
                  <Text size="small" className="text-ui-fg-subtle">
                    {item.raw_materials.description}
                  </Text>
                )}
              </div>
            )}

            {item.location_levels && item.location_levels.length > 0 && (
              <div className="flex flex-col gap-3">
                <Divider />
                <Text weight="plus">Location Levels</Text>
                <div className="space-y-2">
                  {item.location_levels.map((level) => (
                    <div
                      key={level.id}
                      className="rounded-md border border-ui-border-base p-3 text-sm"
                    >
                      <div className="flex items-center justify-between">
                        <Text weight="plus">
                          Location: {level.location_id || "Unknown"}
                        </Text>
                        <Badge size="small" color="grey">
                          {level.inventory_item_id}
                        </Badge>
                      </div>
                      <div className="mt-2 grid gap-3 sm:grid-cols-3">
                        <InfoRow
                          label="Stocked"
                          value={String(level.stocked_quantity ?? 0)}
                        />
                        <InfoRow
                          label="Reserved"
                          value={String(level.reserved_quantity ?? 0)}
                        />
                        <InfoRow
                          label="Incoming"
                          value={String(level.incoming_quantity ?? 0)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </StackedFocusModal.Body>

        <StackedFocusModal.Footer>
          <StackedFocusModal.Close asChild>
            <Button variant="secondary" className="ml-auto">
              Close
            </Button>
          </StackedFocusModal.Close>
        </StackedFocusModal.Footer>
      </StackedFocusModal.Content>
    </StackedFocusModal>
  )
}

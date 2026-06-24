import { Plus, Trash } from "@medusajs/icons"
import {
  Badge,
  Button,
  Container,
  Heading,
  Text,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { Link } from "react-router-dom"

import { Skeleton } from "../../../../components/common/skeleton"
import { mediaUrls } from "../../../../lib/first-media-url"

import { ActionMenu } from "../../../../components/common/action-menu"
import { PartnerDesign } from "../../../../hooks/api/partner-designs"
import {
  PartnerDesignInventoryItem,
  useDelinkPartnerDesignInventory,
  usePartnerDesignInventory,
} from "../../../../hooks/api/partner-design-inventory"

type Props = { design: PartnerDesign }

/**
 * `raw_materials` comes back as a single object (1:1 link), an array, or
 * null depending on the endpoint. Always normalize to an array — iterating
 * the raw object throws "{} is not iterable".
 */
function toArray<T = any>(val: any): T[] {
  if (!val) return []
  return Array.isArray(val) ? val : [val]
}

/**
 * Pull image URLs out of a raw_material.media / inventory media json blob.
 * Delegates to the shared `mediaUrls` helper so every supported shape
 * (`{ files: [...] }`, raw arrays, single object/string) is unwrapped — the
 * canonical prod shape `{ files: ["…"] }` previously returned nothing here.
 */
function extractMedia(line: PartnerDesignInventoryItem): string[] {
  const urls: string[] = []
  for (const rm of toArray(line.inventory_item?.raw_materials)) {
    urls.push(...mediaUrls((rm as any)?.media))
  }
  // Fall back to the inventory item's own media if the raw material has none.
  if (!urls.length) {
    urls.push(...mediaUrls((line.inventory_item as any)?.metadata?.media))
  }
  return urls.slice(0, 4)
}

export const DesignInventoryBomSection = ({ design }: Props) => {
  const prompt = usePrompt()
  const isOwner = !!(design as any).owner_partner_id
  const { inventory_items, isLoading } = usePartnerDesignInventory(design.id)
  const { mutateAsync: delink } = useDelinkPartnerDesignInventory(design.id)

  const handleRemove = async (line: PartnerDesignInventoryItem) => {
    const ok = await prompt({
      title: "Remove material",
      description: `Remove "${line.inventory_item?.title ?? line.inventory_item_id}" from this design's bill of materials?`,
      confirmText: "Remove",
      cancelText: "Cancel",
    })
    if (!ok) return
    await delink(
      { inventoryIds: [line.inventory_item_id] },
      {
        onSuccess: () => toast.success("Material removed"),
        onError: (e) => toast.error(e.message),
      }
    )
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Materials (BOM)</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Inventory + raw materials used to make this design.
          </Text>
        </div>
        {isOwner && (
          <Link to="add-inventory">
            <Button size="small" variant="secondary">
              <Plus />
              Add material
            </Button>
          </Link>
        )}
      </div>

      {isLoading ? (
        <div className="flex flex-col divide-y">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-x-4 px-6 py-4">
              <Skeleton className="size-12 rounded-md" />
              <div className="flex flex-1 flex-col gap-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : inventory_items.length === 0 ? (
        <div className="px-6 py-6">
          <Text size="small" className="text-ui-fg-subtle">
            No materials linked yet.
            {isOwner ? " Add the inventory items this design consumes." : ""}
          </Text>
        </div>
      ) : (
        inventory_items.map((line) => {
          const item = line.inventory_item
          const rawMaterials = toArray(item?.raw_materials)
          const media = extractMedia(line)
          return (
            <div
              key={line.inventory_item_id}
              className="flex items-start gap-x-4 px-6 py-4"
            >
              {/* Media thumbnails — what the material looks like */}
              <div className="flex shrink-0 gap-x-1">
                {media.length > 0 ? (
                  media.map((url, i) => (
                    <img
                      key={i}
                      src={url}
                      alt={item?.title ?? "material"}
                      className="bg-ui-bg-subtle size-12 rounded-md object-cover"
                    />
                  ))
                ) : (
                  <div className="bg-ui-bg-subtle text-ui-fg-muted flex size-12 items-center justify-center rounded-md">
                    <Text size="xsmall">No img</Text>
                  </div>
                )}
              </div>

              {/* Details — title, SKU, raw material, qty */}
              <div className="flex min-w-0 flex-1 flex-col gap-y-1">
                <div className="flex items-center gap-x-2">
                  <Text size="small" weight="plus" className="truncate">
                    {item?.title ?? line.inventory_item_id}
                  </Text>
                  {item?.sku && (
                    <Badge size="2xsmall" color="grey">
                      SKU: {item.sku}
                    </Badge>
                  )}
                </div>

                {rawMaterials.length > 0 && (
                  <Text size="small" className="text-ui-fg-subtle truncate">
                    {rawMaterials
                      .map((rm) =>
                        [rm.name, rm.composition, rm.color]
                          .filter(Boolean)
                          .join(" · ")
                      )
                      .filter(Boolean)
                      .join("  |  ")}
                  </Text>
                )}

                <Text size="xsmall" className="text-ui-fg-muted">
                  Planned: {line.planned_quantity ?? "—"}
                  {line.consumed_quantity != null
                    ? `  ·  Consumed: ${line.consumed_quantity}`
                    : ""}
                </Text>
              </div>

              {isOwner && (
                <ActionMenu
                  groups={[
                    {
                      actions: [
                        {
                          label: "Remove",
                          icon: <Trash />,
                          onClick: () => handleRemove(line),
                        },
                      ],
                    },
                  ]}
                />
              )}
            </div>
          )
        })
      )}
    </Container>
  )
}

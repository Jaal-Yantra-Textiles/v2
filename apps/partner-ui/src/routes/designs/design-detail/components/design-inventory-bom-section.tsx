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
import { useTranslation } from "react-i18next"
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
  const { t } = useTranslation()
  const prompt = usePrompt()
  const isOwner = !!design.is_owner
  const { inventory_items, isLoading } = usePartnerDesignInventory(design.id)
  const { mutateAsync: delink } = useDelinkPartnerDesignInventory(design.id)

  const handleRemove = async (line: PartnerDesignInventoryItem) => {
    const ok = await prompt({
      title: t("partner.designs.bom.removeTitle"),
      description: t("partner.designs.bom.removeDescription", {
        name: line.inventory_item?.title ?? line.inventory_item_id,
      }),
      confirmText: t("actions.remove"),
      cancelText: t("actions.cancel"),
    })
    if (!ok) return
    await delink(
      { inventoryIds: [line.inventory_item_id] },
      {
        onSuccess: () => toast.success(t("partner.designs.bom.removed")),
        onError: (e) => toast.error(e.message),
      }
    )
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-y-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Heading level="h2">{t("partner.designs.bom.heading")}</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {t("partner.designs.bom.subtitle")}
          </Text>
        </div>
        {isOwner && (
          // Absolute so "Add material" works from the nested in-order manager
          // too (the nested route has no add-inventory child).
          <Link to={`/designs/${design.id}/add-inventory`}>
            <Button size="small" variant="secondary">
              <Plus />
              {t("partner.designs.bom.addMaterial")}
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
            {t("partner.designs.bom.empty")}
            {isOwner ? t("partner.designs.bom.emptyOwnerHint") : ""}
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
                      alt={item?.title ?? t("partner.designs.bom.materialAlt")}
                      className="bg-ui-bg-subtle size-12 rounded-md object-cover"
                    />
                  ))
                ) : (
                  <div className="bg-ui-bg-subtle text-ui-fg-muted flex size-12 items-center justify-center rounded-md">
                    <Text size="xsmall">{t("partner.designs.bom.noImg")}</Text>
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
                      {t("partner.designs.bom.sku")}: {item.sku}
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
                  {t("partner.designs.bom.planned")}: {line.planned_quantity ?? "—"}
                  {line.consumed_quantity != null
                    ? `  ·  ${t("partner.designs.bom.consumed")}: ${line.consumed_quantity}`
                    : ""}
                </Text>
              </div>

              {isOwner && (
                <ActionMenu
                  groups={[
                    {
                      actions: [
                        {
                          label: t("actions.remove"),
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
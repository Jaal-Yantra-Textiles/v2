import { useMemo, useState } from "react"
import {
  Badge,
  Button,
  Heading,
  Input,
  Label,
  Text,
  clx,
  toast,
} from "@medusajs/ui"
import { Tag, Plus, XMark, MagnifyingGlass } from "@medusajs/icons"
import { useInventoryWithRawMaterials } from "../../hooks/api/raw-materials"
import {
  useMediaRawMaterialBinding,
  useBindMediaRawMaterial,
  useUnbindMediaRawMaterial,
} from "../../hooks/api/media-raw-material-binding"

export type BindRawMaterialSectionProps = {
  mediaId: string
  mediaUrl?: string
  mediaName?: string
}

/**
 * Manual photo → raw-material binding tool (#730). Shown in the media gallery
 * for an individual photo. Human-toggled, no AI.
 */
export const BindRawMaterialSection = ({
  mediaId,
  mediaName,
}: BindRawMaterialSectionProps) => {
  const [search, setSearch] = useState("")
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const [newSku, setNewSku] = useState("")

  const { data: bindingData, isLoading: bindingLoading } =
    useMediaRawMaterialBinding(mediaId)
  const binding = bindingData?.binding ?? null

  const { inventory_items, isFetching } = useInventoryWithRawMaterials(
    { q: search || undefined, limit: 20 },
    { enabled: !binding }
  )

  const bind = useBindMediaRawMaterial(mediaId)
  const unbind = useUnbindMediaRawMaterial(mediaId)

  const results = useMemo(
    () => (inventory_items || []).filter((it) => it.raw_materials?.id),
    [inventory_items]
  )

  const handleBindExisting = (
    rawMaterialId: string,
    inventoryItemId: string,
    name?: string
  ) => {
    bind.mutate(
      { raw_material_id: rawMaterialId, inventory_item_id: inventoryItemId },
      {
        onSuccess: () => toast.success(`Bound to “${name ?? "raw material"}”`),
        onError: (e: any) =>
          toast.error(e?.message || "Failed to bind raw material"),
      }
    )
  }

  const handleCreate = () => {
    if (!newName.trim()) {
      toast.error("Name is required")
      return
    }
    bind.mutate(
      { create: { name: newName.trim(), sku: newSku.trim() || undefined } },
      {
        onSuccess: () => {
          toast.success(`Created & bound “${newName.trim()}”`)
          setCreating(false)
          setNewName("")
          setNewSku("")
        },
        onError: (e: any) =>
          toast.error(e?.message || "Failed to create raw material"),
      }
    )
  }

  const handleUnbind = () => {
    if (!binding) return
    unbind.mutate(
      { raw_material_id: binding.raw_material_id },
      {
        onSuccess: () => toast.success("Unbound"),
        onError: (e: any) => toast.error(e?.message || "Failed to unbind"),
      }
    )
  }

  return (
    <div className="flex flex-col gap-y-4 p-4">
      <div className="flex items-center gap-x-2">
        <Tag className="text-ui-fg-subtle" />
        <Heading level="h3">Raw material</Heading>
      </div>
      <Text size="small" className="text-ui-fg-subtle">
        Bind {mediaName ? `“${mediaName}”` : "this photo"} to a raw material so it
        shows wherever that material appears.
      </Text>

      {bindingLoading ? (
        <div className="bg-ui-bg-component h-16 w-full animate-pulse rounded-lg" />
      ) : binding ? (
        <div className="border-ui-border-base flex flex-col gap-y-3 rounded-lg border p-3">
          <div className="flex items-center justify-between gap-x-2">
            <div className="flex flex-col">
              <Text size="small" weight="plus">
                {binding.raw_material_name || "Raw material"}
              </Text>
              {binding.sku ? (
                <Badge size="2xsmall" className="mt-1 w-fit">
                  {binding.sku}
                </Badge>
              ) : (
                <Text size="xsmall" className="text-ui-fg-muted">
                  No SKU
                </Text>
              )}
            </div>
            <Button
              variant="secondary"
              size="small"
              onClick={handleUnbind}
              isLoading={unbind.isPending}
            >
              <XMark />
              Unbind
            </Button>
          </div>
        </div>
      ) : creating ? (
        <div className="border-ui-border-base flex flex-col gap-y-3 rounded-lg border p-3">
          <div className="flex flex-col gap-y-1">
            <Label size="xsmall" weight="plus">
              Name
            </Label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Leftover navy poplin"
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-y-1">
            <Label size="xsmall" weight="plus">
              SKU (optional)
            </Label>
            <Input
              value={newSku}
              onChange={(e) => setNewSku(e.target.value)}
              placeholder="auto-generated if blank"
            />
          </div>
          <div className="flex items-center justify-end gap-x-2">
            <Button
              variant="secondary"
              size="small"
              onClick={() => setCreating(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="small"
              onClick={handleCreate}
              isLoading={bind.isPending}
            >
              Create & bind
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-y-3">
          <div className="relative">
            <MagnifyingGlass className="text-ui-fg-muted absolute left-2 top-1/2 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search raw materials by name or SKU"
              className="pl-8"
            />
          </div>

          <div className="flex max-h-72 flex-col gap-y-1 overflow-y-auto">
            {isFetching && !results.length ? (
              <div className="bg-ui-bg-component h-10 w-full animate-pulse rounded-lg" />
            ) : results.length ? (
              results.map((it) => {
                const rm = it.raw_materials!
                return (
                  <button
                    key={rm.id}
                    type="button"
                    onClick={() =>
                      handleBindExisting(rm.id, it.id, rm.name)
                    }
                    disabled={bind.isPending}
                    className={clx(
                      "hover:bg-ui-bg-base-hover flex items-center justify-between gap-x-2 rounded-lg px-3 py-2 text-left transition-colors",
                      "border-ui-border-base border"
                    )}
                  >
                    <span className="flex flex-col">
                      <Text size="small" weight="plus" leading="compact">
                        {rm.name}
                      </Text>
                      <Text
                        size="xsmall"
                        leading="compact"
                        className="text-ui-fg-muted"
                      >
                        {rm.composition || "—"}
                      </Text>
                    </span>
                    {it.sku ? (
                      <Badge size="2xsmall">{it.sku}</Badge>
                    ) : null}
                  </button>
                )
              })
            ) : (
              <Text size="small" className="text-ui-fg-muted px-1 py-2">
                No raw materials found.
              </Text>
            )}
          </div>

          <Button
            variant="transparent"
            size="small"
            className="w-fit"
            onClick={() => setCreating(true)}
          >
            <Plus />
            Create new raw material
          </Button>
        </div>
      )}
    </div>
  )
}

export default BindRawMaterialSection

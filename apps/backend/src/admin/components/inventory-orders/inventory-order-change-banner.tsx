import { Button, Container, Heading, Input, Select, Text, toast, usePrompt } from "@medusajs/ui"
import { CheckCircleSolid, ExclamationCircleSolid, XCircleSolid } from "@medusajs/icons"
import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"

import { sdk } from "../../lib/config"
import { useRawMaterialGroups } from "../../hooks/api/raw-material-groups"

import { AdminInventoryOrder } from "../../hooks/api/inventory-orders"
import {
  useApproveInventoryOrderChange,
  useInventoryOrderChanges,
  useRejectInventoryOrderChange,
  useReviseProposedNewLine,
  type AdminInventoryOrderChange,
  type InventoryOrderChangeLine,
} from "../../hooks/api/inventory-orders"

type InventoryOrderChangeBannerProps = {
  inventoryOrder: AdminInventoryOrder
}

const money = (n: number | null | undefined) =>
  n == null || !Number.isFinite(Number(n)) ? "—" : `₹${Number(n)}`

/**
 * #1752 — the partner's proposed revision, shown as a striped banner across the
 * top of the inventory-order detail (the same visual language Medusa core uses
 * for a pending order-change). An operator approves or rejects it here; until
 * then the proposal has NOT touched the real lines or the payable ceiling.
 *
 * Renders only when a PENDING change exists — resolved (approved/rejected)
 * changes are history, not a call to action. No banner = nothing to decide.
 */
export const InventoryOrderChangeBanner = ({
  inventoryOrder,
}: InventoryOrderChangeBannerProps) => {
  const prompt = usePrompt()

  const { changes } = useInventoryOrderChanges(inventoryOrder.id)
  const { mutateAsync: approve } = useApproveInventoryOrderChange(inventoryOrder.id)
  const { mutateAsync: reject } = useRejectInventoryOrderChange(inventoryOrder.id)

  const pending = useMemo<AdminInventoryOrderChange | undefined>(() => {
    const list = Array.isArray(changes) ? changes : []
    return list.find((c) => c?.status === "pending")
  }, [changes])

  // Resolve proposed line ids to their titles for a readable diff.
  const lineById = useMemo(() => {
    const map = new Map<string, any>()
    const lines = (inventoryOrder as any).orderlines ?? inventoryOrder.order_lines ?? []
    for (const l of Array.isArray(lines) ? lines : []) {
      if (l?.id) map.set(l.id, l)
    }
    return map
  }, [inventoryOrder])

  if (!pending) {
    return null
  }

  const proposedLines = Array.isArray(pending.proposed_lines)
    ? pending.proposed_lines
    : []
  const proposedCharges = Array.isArray(pending.proposed_charges)
    ? pending.proposed_charges
    : []

  const removed = proposedLines.filter((l) => l.remove && l.id)
  const edited = proposedLines.filter((l) => !l.remove && l.id)
  // #2659 — cloth the partner added that the order did not list.
  const added = proposedLines.filter(
    (l) => !l.id && !l.remove && l.new_material?.name
  )
  const taxTotal = proposedCharges.reduce(
    (sum, c) => sum + (Number(c?.amount) || 0),
    0
  )

  const labelFor = (id?: string) => {
    if (!id) return "—"
    const line = lineById.get(id)
    return (
      line?.material_name ||
      line?.inventory_items?.[0]?.title ||
      line?.inventory_items?.[0]?.name ||
      id
    )
  }

  const onApprove = async () => {
    const confirmed = await prompt({
      title: "Approve partner changes?",
      description:
        "This applies the proposed line edits and tax to the order and raises the payable ceiling. It cannot be undone.",
      confirmText: "Approve",
      cancelText: "Cancel",
    })
    if (!confirmed) return
    try {
      await approve(pending.id)
      toast.success("Change approved")
    } catch (e: any) {
      toast.error(e?.message || "Failed to approve change")
    }
  }

  const onReject = async () => {
    const confirmed = await prompt({
      title: "Reject partner changes?",
      description:
        "The proposal will be closed and the order stays as it was. The partner can propose again.",
      confirmText: "Reject",
      cancelText: "Cancel",
    })
    if (!confirmed) return
    try {
      await reject({ changeId: pending.id })
      toast.success("Change rejected")
    } catch (e: any) {
      toast.error(e?.message || "Failed to reject change")
    }
  }

  return (
    <div
      style={{
        background:
          "repeating-linear-gradient(-45deg, rgb(212, 212, 216, 0.15), rgb(212, 212, 216,.15) 10px, transparent 10px, transparent 20px)",
      }}
      className="-m-4 mb-1 border-b border-l p-4"
    >
      <Container className="flex flex-col divide-y divide-dashed p-0">
        <div className="flex items-center gap-2 px-6 py-4">
          <ExclamationCircleSolid className="text-blue-500" />
          <Heading level="h2">Partner proposed changes</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            pending approval — not applied yet
          </Text>
        </div>

        {edited.length > 0 && (
          <div className="flex flex-col gap-y-1 px-6 py-4">
            <Text size="small" className="text-ui-fg-subtle font-medium">
              Line changes
            </Text>
            {edited.map((l) => {
              const original = lineById.get(l.id!)
              return (
                <div key={l.id} className="flex flex-col gap-y-1 text-sm">
                  <div className="flex items-center gap-x-3">
                  <span className="flex-1 truncate">{labelFor(l.id)}</span>
                  {original ? (
                    <span className="text-ui-fg-muted">
                      {money(original.price)} × {original.quantity} → {money(l.price)} × {l.quantity}
                    </span>
                  ) : (
                    <span className="text-ui-fg-muted">
                      {money(l.price)} × {l.quantity}
                    </span>
                  )}
                  </div>
                  <PhotoStrip photos={l.photos} />
                </div>
              )
            })}
          </div>
        )}

        {added.length > 0 && (
          <div className="flex flex-col gap-y-3 px-6 py-4">
            <Text size="small" className="text-ui-fg-subtle font-medium">
              New items from the partner ({added.length}) — approving creates these as inventory items
            </Text>
            {added.map((l) => (
              <ProposedNewItemRow
                key={l.key ?? l.new_material!.name}
                orderId={inventoryOrder.id}
                changeId={pending.id}
                line={l}
              />
            ))}
          </div>
        )}

        {removed.length > 0 && (
          <div className="flex flex-col gap-y-1 px-6 py-4">
            <Text size="small" className="text-ui-fg-subtle font-medium">
              Removed lines
            </Text>
            {removed.map((l) => (
              <div key={l.id} className="flex items-center gap-x-3 text-sm">
                <span className="flex-1 truncate line-through">{labelFor(l.id)}</span>
                <XCircleSolid className="text-ui-fg-muted" />
              </div>
            ))}
          </div>
        )}

        {proposedCharges.length > 0 && (
          <div className="flex flex-col gap-y-1 px-6 py-4">
            <Text size="small" className="text-ui-fg-subtle font-medium">
              Proposed tax
            </Text>
            {proposedCharges.map((c, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-ui-fg-muted">{c.note || "Tax"}</span>
                <span>{money(c.amount)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between text-sm font-medium">
              <span>Tax total</span>
              <span>{money(taxTotal)}</span>
            </div>
          </div>
        )}

        <div className="bg-ui-bg-subtle flex items-center justify-end gap-x-2 rounded-b-xl px-4 py-4">
          <Button size="small" variant="secondary" onClick={onReject}>
            <XCircleSolid />
            Reject
          </Button>
          <Button size="small" variant="primary" onClick={onApprove}>
            <CheckCircleSolid />
            Approve
          </Button>
        </div>
      </Container>
    </div>
  )
}

/** #2659 — thumbnails of the photos a partner attached; each opens full size. */
const PhotoStrip = ({ photos }: { photos?: string[] }) => {
  if (!photos?.length) return null
  return (
    <div className="flex flex-wrap gap-2">
      {photos.map((url) => (
        <a key={url} href={url} target="_blank" rel="noreferrer">
          <img
            src={url}
            alt=""
            className="h-16 w-16 rounded-md border object-cover"
            loading="lazy"
          />
        </a>
      ))}
    </div>
  )
}

/**
 * #2659 — one partner-proposed new item: its photos, quantity × price, and the
 * two ways to sort it before approval — rename (name/colour) or drop.
 */
const ProposedNewItemRow = ({
  orderId,
  changeId,
  line,
}: {
  orderId: string
  changeId: string
  line: InventoryOrderChangeLine
}) => {
  const prompt = usePrompt()
  const { mutateAsync: revise, isPending } = useReviseProposedNewLine(orderId)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(line.new_material?.name ?? "")
  const [color, setColor] = useState(line.new_material?.color ?? "")

  const material = line.new_material!
  const title = material.color ? `${material.name} — ${material.color}` : material.name

  const onSave = async () => {
    if (!line.key || !name.trim()) return
    try {
      await revise({
        changeId,
        key: line.key,
        new_material: {
          name: name.trim(),
          ...(color.trim() ? { color: color.trim() } : {}),
        },
      })
      setEditing(false)
      toast.success("Item renamed")
    } catch (e: any) {
      toast.error(e?.message || "Failed to rename item")
    }
  }

  const onDrop = async () => {
    if (!line.key) return
    const confirmed = await prompt({
      title: `Drop "${title}"?`,
      description:
        "It is taken out of the partner's proposal, so approving will not create it. The rest of the proposal is unchanged.",
      confirmText: "Drop",
      cancelText: "Cancel",
    })
    if (!confirmed) return
    try {
      await revise({ changeId, key: line.key, drop: true })
      toast.success("Item dropped from the proposal")
    } catch (e: any) {
      toast.error(e?.message || "Failed to drop item")
    }
  }

  return (
    <div className="flex flex-col gap-y-2 rounded-lg border p-3 text-sm">
      {editing ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input size="small" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
          <Input size="small" value={color} onChange={(e) => setColor(e.target.value)} placeholder="Colour" />
          <Button size="small" variant="primary" onClick={onSave} isLoading={isPending} disabled={!name.trim()}>
            Save
          </Button>
          <Button size="small" variant="transparent" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-x-3">
          <span className="flex-1 truncate font-medium">{title}</span>
          <span className="text-ui-fg-muted">
            {money(line.price)} × {line.quantity}
            {material.unit_of_measure ? ` ${material.unit_of_measure}` : ""}
          </span>
          <Button size="small" variant="secondary" onClick={() => setEditing(true)} disabled={!line.key}>
            Rename
          </Button>
          <Button size="small" variant="secondary" onClick={onDrop} disabled={!line.key || isPending}>
            Drop
          </Button>
        </div>
      )}
      {material.composition ? (
        <Text size="xsmall" className="text-ui-fg-subtle">{material.composition}</Text>
      ) : null}
      <PhotoStrip photos={line.photos} />
      {line.key ? (
        <AttachEditor orderId={orderId} changeId={changeId} lineKey={line.key} attach={line.attach} />
      ) : null}
    </div>
  )
}

const NEW_GROUP = "__new__"
const NO_GROUP = "__none__"

/**
 * #2659 — OPTIONAL: where this item lands once approval creates it. A colour
 * group (existing, or a new one by name) and/or a product variant the item
 * becomes stock for. Both default to none; approval works either way.
 */
const AttachEditor = ({
  orderId,
  changeId,
  lineKey,
  attach,
}: {
  orderId: string
  changeId: string
  lineKey: string
  attach?: InventoryOrderChangeLine["attach"]
}) => {
  const { mutateAsync: revise, isPending } = useReviseProposedNewLine(orderId)
  const { data: groupsData } = useRawMaterialGroups({ limit: 100 })
  const groups = groupsData?.raw_material_groups ?? []

  const [groupChoice, setGroupChoice] = useState<string>(
    attach?.raw_material_group_id ?? (attach?.new_group_name ? NEW_GROUP : NO_GROUP)
  )
  const [newGroupName, setNewGroupName] = useState(attach?.new_group_name ?? "")
  const [variantQuery, setVariantQuery] = useState("")
  const [variantId, setVariantId] = useState<string | undefined>(attach?.variant_id)
  const [requiredQty, setRequiredQty] = useState(String(attach?.required_quantity ?? 1))

  // Variants, not products: a filtered /admin/products goes through the index
  // engine, which can return a count with no rows.
  const { data: variantsData } = useQuery({
    queryKey: ["inventory-order-attach-variants", variantQuery],
    queryFn: () =>
      sdk.client.fetch<{ variants: Array<{ id: string; title?: string; sku?: string; product?: { title?: string } }> }>(
        "/admin/product-variants",
        { query: { q: variantQuery, limit: 10, fields: "id,title,sku,product.title" } }
      ),
    enabled: variantQuery.trim().length >= 2,
  })
  const variants = variantsData?.variants ?? []

  const onSave = async (clear = false) => {
    const next = clear
      ? null
      : {
          ...(groupChoice === NEW_GROUP && newGroupName.trim()
            ? { new_group_name: newGroupName.trim() }
            : {}),
          ...(groupChoice !== NEW_GROUP && groupChoice !== NO_GROUP
            ? { raw_material_group_id: groupChoice }
            : {}),
          ...(variantId
            ? { variant_id: variantId, required_quantity: Number(requiredQty) > 0 ? Number(requiredQty) : 1 }
            : {}),
        }
    try {
      await revise({ changeId, key: lineKey, attach: next })
      if (clear) {
        setGroupChoice(NO_GROUP)
        setNewGroupName("")
        setVariantId(undefined)
      }
      toast.success(clear ? "Cleared" : "Saved — applied when you approve")
    } catch (e: any) {
      toast.error(e?.message || "Failed to save")
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-dashed pt-2">
      <Text size="xsmall" className="text-ui-fg-subtle">
        On approval, also (optional):
      </Text>
      <div className="flex flex-wrap items-center gap-2">
        <Text size="small" className="w-24">Colour group</Text>
        <Select value={groupChoice} onValueChange={setGroupChoice} size="small">
          <Select.Trigger className="w-56">
            <Select.Value placeholder="None" />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value={NO_GROUP}>None</Select.Item>
            <Select.Item value={NEW_GROUP}>New group…</Select.Item>
            {groups.map((g: any) => (
              <Select.Item key={g.id} value={g.id}>{g.name}</Select.Item>
            ))}
          </Select.Content>
        </Select>
        {groupChoice === NEW_GROUP ? (
          <Input size="small" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="New group name" />
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Text size="small" className="w-24">Product</Text>
        {variantId ? (
          <>
            <Text size="small" className="font-medium">
              {variants.find((v) => v.id === variantId)
                ? `${variants.find((v) => v.id === variantId)!.product?.title ?? ""} · ${variants.find((v) => v.id === variantId)!.title ?? ""}`
                : variantId}
            </Text>
            <Input
              size="small"
              className="w-24"
              value={requiredQty}
              onChange={(e) => setRequiredQty(e.target.value)}
              placeholder="Qty per unit"
            />
            <Button size="small" variant="transparent" onClick={() => setVariantId(undefined)}>
              Change
            </Button>
          </>
        ) : (
          <div className="flex flex-col gap-1">
            <Input
              size="small"
              className="w-56"
              value={variantQuery}
              onChange={(e) => setVariantQuery(e.target.value)}
              placeholder="Search a product variant"
            />
            {variants.map((v) => (
              <button
                key={v.id}
                type="button"
                className="text-ui-fg-interactive text-left text-xs"
                onClick={() => setVariantId(v.id)}
              >
                {v.product?.title ?? "Product"} · {v.title ?? v.sku ?? v.id}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <Button size="small" variant="secondary" onClick={() => onSave(false)} isLoading={isPending}>
          Save attach
        </Button>
        {attach ? (
          <Button size="small" variant="transparent" onClick={() => onSave(true)} disabled={isPending}>
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export default InventoryOrderChangeBanner
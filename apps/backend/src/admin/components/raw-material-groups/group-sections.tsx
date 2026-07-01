import {
  Badge,
  Button,
  Checkbox,
  Container,
  DataTable,
  DataTablePaginationState,
  DataTableRowSelectionState,
  Heading,
  Input,
  Label,
  Select,
  Table,
  Text,
  FocusModal,
  createDataTableColumnHelper,
  toast,
  useDataTable,
} from "@medusajs/ui"
import { PencilSquare, Plus, Component as ComponentIcon, Link as LinkIcon } from "@medusajs/icons"
import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"

import { ActionMenu } from "../common/action-menu"
import {
  RawMaterialGroup,
  RawMaterialGroupColor,
  useAddGroupColor,
  useLinkGroupColors,
  useCreateGroupOrder,
  useRawMaterialGroupOrders,
} from "../../hooks/api/raw-material-groups"
import { useInventoryWithRawMaterials } from "../../hooks/api/raw-materials"
import { useStockLocations } from "../../hooks/api/stock_location"
import { useDebouncedSearch } from "../../hooks/use-debounce"

// ---------------------------------------------------------------------------
// General section
// ---------------------------------------------------------------------------

export const GroupGeneralSection = ({ group }: { group: RawMaterialGroup }) => {
  const rows: Array<[string, React.ReactNode]> = [
    ["Composition", group.composition || "—"],
    ["Unit of measure", group.unit_of_measure || "—"],
    ["Material type", group.material_type?.name || "—"],
    ["Colors", group.raw_materials?.length ?? 0],
  ]

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading>{group.name}</Heading>
        <Badge size="small" color={group.status === "Active" || !group.status ? "green" : "grey"}>
          {group.status || "Active"}
        </Badge>
      </div>
      {rows.map(([label, value]) => (
        <div
          key={label}
          className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4"
        >
          <Text size="small" leading="compact" weight="plus">
            {label}
          </Text>
          <Text size="small">{value}</Text>
        </div>
      ))}
    </Container>
  )
}

// ---------------------------------------------------------------------------
// Add-color: quick modal (name + color)
// ---------------------------------------------------------------------------

const QuickAddColorModal = ({
  groupId,
  open,
  onOpenChange,
}: {
  groupId: string
  open: boolean
  onOpenChange: (v: boolean) => void
}) => {
  const [name, setName] = useState("")
  const [color, setColor] = useState("")
  const { mutateAsync, isPending } = useAddGroupColor(groupId)

  const submit = async () => {
    if (!name.trim() || !color.trim()) {
      toast.error("Name and color are required")
      return
    }
    try {
      await mutateAsync({ name: name.trim(), color: color.trim() })
      toast.success("Color added")
      onOpenChange(false)
      setName("")
      setColor("")
    } catch (e: any) {
      toast.error(e?.message || "Failed to add color")
    }
  }

  return (
    <FocusModal open={open} onOpenChange={onOpenChange}>
      <FocusModal.Content>
        <FocusModal.Header>
          <Button size="small" onClick={submit} isLoading={isPending}>Save</Button>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-col items-center py-16">
          <div className="flex w-full max-w-lg flex-col gap-y-6">
            <div>
              <FocusModal.Title asChild>
                <Heading>Quick add a color</Heading>
              </FocusModal.Title>
              <FocusModal.Description asChild>
                <Text size="small" className="text-ui-fg-subtle">
                  Capture just a name and color now. The stock item is created on the first order.
                </Text>
              </FocusModal.Description>
            </div>
            <div className="flex flex-col gap-y-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Cotton Poplin — Blue" />
            </div>
            <div className="flex flex-col gap-y-2">
              <Label>Color</Label>
              <Input value={color} onChange={(e) => setColor(e.target.value)} placeholder="Blue" />
            </div>
          </div>
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
  )
}

// ---------------------------------------------------------------------------
// Add-color: link an existing raw material
// ---------------------------------------------------------------------------

type LinkCandidate = {
  rawMaterialId: string
  name: string
  color: string
  sku: string
}

const linkColumnHelper = createDataTableColumnHelper<LinkCandidate>()

const linkColumns = [
  linkColumnHelper.select(),
  linkColumnHelper.accessor("name", { header: "Name" }),
  linkColumnHelper.accessor("color", {
    header: "Color",
    cell: ({ getValue }) =>
      getValue() ? <Badge size="small" color="grey">{getValue()}</Badge> : "—",
  }),
  linkColumnHelper.accessor("sku", {
    header: "SKU",
    cell: ({ getValue }) => (
      <span className="text-ui-fg-subtle">{getValue() || "—"}</span>
    ),
  }),
]

const LinkExistingColorsModal = ({
  groupId,
  open,
  onOpenChange,
}: {
  groupId: string
  open: boolean
  onOpenChange: (v: boolean) => void
}) => {
  const { searchValue, onSearchValueChange, query } = useDebouncedSearch()
  const [rowSelection, setRowSelection] = useState<DataTableRowSelectionState>({})
  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageIndex: 0,
    pageSize: 10,
  })
  const { mutateAsync, isPending } = useLinkGroupColors(groupId)
  // Search is done server-side (the endpoint's full-text `q` across inventory +
  // raw-material fields), not with a local filter.
  const { inventory_items = [], isLoading } = useInventoryWithRawMaterials({
    q: query,
    fields: "+raw_materials.*",
    limit: 200,
  })

  // Only ungrouped raw materials can be linked — a color belongs to one group.
  // This is a business rule, not search, so it stays client-side.
  const candidates: LinkCandidate[] = useMemo(
    () =>
      inventory_items
        .filter((it: any) => it.raw_materials && !it.raw_materials.group_id)
        .map((it: any) => ({
          rawMaterialId: it.raw_materials.id as string,
          name: it.raw_materials.name as string,
          color: (it.raw_materials.color as string) || "",
          sku: it.inventory_item?.sku || it.sku || "",
        })),
    [inventory_items]
  )

  const paginated = useMemo(() => {
    const start = pagination.pageIndex * pagination.pageSize
    return candidates.slice(start, start + pagination.pageSize)
  }, [candidates, pagination])

  const table = useDataTable({
    columns: linkColumns,
    data: paginated,
    getRowId: (row) => row.rawMaterialId,
    rowCount: candidates.length,
    isLoading,
    rowSelection: {
      state: rowSelection,
      onRowSelectionChange: setRowSelection,
    },
    pagination: {
      state: pagination,
      onPaginationChange: setPagination,
    },
    search: {
      state: searchValue,
      onSearchChange: onSearchValueChange,
    },
  })

  const selectedIds = useMemo(
    () => Object.keys(rowSelection).filter((id) => rowSelection[id]),
    [rowSelection]
  )

  const submit = async () => {
    if (!selectedIds.length) {
      toast.error("Select at least one raw material")
      return
    }
    try {
      await mutateAsync(selectedIds)
      toast.success(`Linked ${selectedIds.length} color(s)`)
      onOpenChange(false)
      setRowSelection({})
    } catch (e: any) {
      toast.error(e?.message || "Failed to link colors")
    }
  }

  return (
    <FocusModal open={open} onOpenChange={onOpenChange}>
      <FocusModal.Content className="flex flex-col">
        <FocusModal.Header>
          <Button size="small" onClick={submit} isLoading={isPending}>
            Link {selectedIds.length || ""}
          </Button>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-1 flex-col overflow-hidden p-0">
          <DataTable instance={table}>
            <DataTable.Toolbar className="flex flex-col items-start gap-y-3 px-6 py-4">
              <div>
                <FocusModal.Title asChild>
                  <Heading>Link existing raw materials</Heading>
                </FocusModal.Title>
                <FocusModal.Description asChild>
                  <Text size="small" className="text-ui-fg-subtle">
                    Attach materials that already exist (with their stock item) as colors of this group.
                  </Text>
                </FocusModal.Description>
              </div>
              <DataTable.Search placeholder="Search by name, color or SKU" />
            </DataTable.Toolbar>
            <DataTable.Table />
            <DataTable.Pagination />
          </DataTable>
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
  )
}

// ---------------------------------------------------------------------------
// Order the group in colors (fan-out)
// ---------------------------------------------------------------------------

type LineDraft = { selected: boolean; quantity: string; price: string }

const OrderInColorsModal = ({
  groupId,
  colors,
  open,
  onOpenChange,
}: {
  groupId: string
  colors: RawMaterialGroupColor[]
  open: boolean
  onOpenChange: (v: boolean) => void
}) => {
  const [stockLocationId, setStockLocationId] = useState<string>("")
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({})
  const { stock_locations = [] } = useStockLocations()
  const { mutateAsync, isPending } = useCreateGroupOrder(groupId)

  const setDraft = (id: string, patch: Partial<LineDraft>) =>
    setDrafts((d) => ({
      ...d,
      [id]: { selected: false, quantity: "", price: "", ...d[id], ...patch },
    }))

  const submit = async () => {
    const lines = colors
      .filter((c) => drafts[c.id]?.selected)
      .map((c) => ({
        raw_material_id: c.id,
        quantity: Number(drafts[c.id]?.quantity) || 0,
        price: Number(drafts[c.id]?.price) || 0,
      }))
    if (!lines.length) {
      toast.error("Select at least one color")
      return
    }
    if (!stockLocationId) {
      toast.error("Select a stock location")
      return
    }
    const now = new Date()
    const eta = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    try {
      const res = await mutateAsync({
        lines,
        status: "Pending",
        order_date: now.toISOString(),
        expected_delivery_date: eta.toISOString(),
        shipping_address: {},
        stock_location_id: stockLocationId,
      })
      const created = res.created_inventory_item_ids?.length
        ? ` (${res.created_inventory_item_ids.length} new item(s) created)`
        : ""
      toast.success(`Order placed${created}`)
      onOpenChange(false)
      setDrafts({})
    } catch (e: any) {
      toast.error(e?.message || "Failed to place order")
    }
  }

  return (
    <FocusModal open={open} onOpenChange={onOpenChange}>
      <FocusModal.Content>
        <FocusModal.Header>
          <Button size="small" onClick={submit} isLoading={isPending}>Place order</Button>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-col items-center py-16">
          <div className="flex w-full max-w-2xl flex-col gap-y-6">
            <div>
              <FocusModal.Title asChild>
                <Heading>Order this group in colors</Heading>
              </FocusModal.Title>
              <FocusModal.Description asChild>
                <Text size="small" className="text-ui-fg-subtle">
                  One order line per selected color. Colors without stock are created automatically.
                </Text>
              </FocusModal.Description>
            </div>
            <div className="flex flex-col gap-y-2">
              <Label>Ship to location</Label>
              <Select value={stockLocationId} onValueChange={setStockLocationId}>
                <Select.Trigger>
                  <Select.Value placeholder="Select a stock location" />
                </Select.Trigger>
                <Select.Content>
                  {stock_locations.map((sl: any) => (
                    <Select.Item key={sl.id} value={sl.id}>{sl.name}</Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </div>
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell> </Table.HeaderCell>
                  <Table.HeaderCell>Color</Table.HeaderCell>
                  <Table.HeaderCell>Quantity</Table.HeaderCell>
                  <Table.HeaderCell>Unit price</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {colors.map((c) => {
                  const d = drafts[c.id]
                  return (
                    <Table.Row key={c.id}>
                      <Table.Cell>
                        <Checkbox
                          checked={!!d?.selected}
                          onCheckedChange={(v) => setDraft(c.id, { selected: !!v })}
                        />
                      </Table.Cell>
                      <Table.Cell>{c.color || c.name}</Table.Cell>
                      <Table.Cell>
                        <Input
                          type="number"
                          disabled={!d?.selected}
                          value={d?.quantity ?? ""}
                          onChange={(e) => setDraft(c.id, { quantity: e.target.value })}
                        />
                      </Table.Cell>
                      <Table.Cell>
                        <Input
                          type="number"
                          disabled={!d?.selected}
                          value={d?.price ?? ""}
                          onChange={(e) => setDraft(c.id, { price: e.target.value })}
                        />
                      </Table.Cell>
                    </Table.Row>
                  )
                })}
              </Table.Body>
            </Table>
          </div>
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
  )
}

// ---------------------------------------------------------------------------
// Colors section
// ---------------------------------------------------------------------------

export const GroupColorsSection = ({ group }: { group: RawMaterialGroup }) => {
  const colors = useMemo(() => group.raw_materials ?? [], [group])
  const [quickOpen, setQuickOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [orderOpen, setOrderOpen] = useState(false)

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Colors</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Each color is its own stock item; ordering fans out one line per color.
          </Text>
        </div>
        <div className="flex items-center gap-x-2">
          <Button size="small" onClick={() => setOrderOpen(true)} disabled={!colors.length}>
            Order in colors
          </Button>
          <ActionMenu
            groups={[
              {
                actions: [
                  {
                    icon: <Plus />,
                    label: "Quick add (name + color)",
                    onClick: () => setQuickOpen(true),
                  },
                  {
                    icon: <ComponentIcon />,
                    label: "Add with full material spec",
                    to: `/raw-material-groups/${group.id}/colors/create`,
                  },
                  {
                    icon: <LinkIcon />,
                    label: "Link an existing raw material",
                    onClick: () => setLinkOpen(true),
                  },
                ],
              },
            ]}
          >
            <Button size="small" variant="secondary">Add color</Button>
          </ActionMenu>
        </div>
      </div>

      {!colors.length ? (
        <div className="px-6 py-8 text-center">
          <Text className="text-ui-fg-subtle">No colors yet. Add one to order this group.</Text>
        </div>
      ) : (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Color</Table.HeaderCell>
              <Table.HeaderCell>Name</Table.HeaderCell>
              <Table.HeaderCell>SKU</Table.HeaderCell>
              <Table.HeaderCell>Stock item</Table.HeaderCell>
              <Table.HeaderCell> </Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {colors.map((c) => (
              <Table.Row key={c.id}>
                <Table.Cell>
                  {c.color ? <Badge size="small" color="grey">{c.color}</Badge> : "—"}
                </Table.Cell>
                <Table.Cell>{c.name}</Table.Cell>
                <Table.Cell className="text-ui-fg-subtle">
                  {c.inventory_item?.sku || "—"}
                </Table.Cell>
                <Table.Cell>
                  <Badge size="small" color={c.inventory_item?.id ? "green" : "orange"}>
                    {c.inventory_item?.id ? "Yes" : "On first order"}
                  </Badge>
                </Table.Cell>
                <Table.Cell onClick={(e) => e.stopPropagation()}>
                  <ActionMenu
                    groups={[
                      {
                        actions: [
                          {
                            icon: <PencilSquare />,
                            label: "View stock item",
                            to: c.inventory_item?.id
                              ? `/inventory/${c.inventory_item.id}`
                              : `/raw-material-groups/${group.id}`,
                            disabled: !c.inventory_item?.id,
                          },
                        ],
                      },
                    ]}
                  />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}

      <QuickAddColorModal groupId={group.id} open={quickOpen} onOpenChange={setQuickOpen} />
      <LinkExistingColorsModal groupId={group.id} open={linkOpen} onOpenChange={setLinkOpen} />
      <OrderInColorsModal
        groupId={group.id}
        colors={colors}
        open={orderOpen}
        onOpenChange={setOrderOpen}
      />
    </Container>
  )
}

// ---------------------------------------------------------------------------
// Orders section — order lines for this group's colors, grouped by color
// ---------------------------------------------------------------------------

const STATUS_COLOR: Record<string, "green" | "orange" | "red" | "grey" | "blue"> = {
  Pending: "orange",
  Processing: "blue",
  Shipped: "blue",
  Delivered: "green",
  Cancelled: "red",
}

export const GroupOrdersSection = ({ groupId }: { groupId: string }) => {
  const navigate = useNavigate()
  const { data, isLoading } = useRawMaterialGroupOrders(groupId)
  const lines = data?.order_lines ?? []

  const grouped = useMemo(() => {
    const map = new Map<string, typeof lines>()
    for (const l of lines) {
      const key = l.color || l.material_name || "Unspecified"
      const arr = map.get(key) ?? []
      arr.push(l)
      map.set(key, arr)
    }
    return Array.from(map.entries())
  }, [lines])

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Orders</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Every inventory order placed for this group's colors.
          </Text>
        </div>
      </div>

      {isLoading ? (
        <div className="px-6 py-8 text-center">
          <Text className="text-ui-fg-subtle">Loading orders…</Text>
        </div>
      ) : !lines.length ? (
        <div className="px-6 py-8 text-center">
          <Text className="text-ui-fg-subtle">No orders yet for this group.</Text>
        </div>
      ) : (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Color</Table.HeaderCell>
              <Table.HeaderCell>Order</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell>Quantity</Table.HeaderCell>
              <Table.HeaderCell>Ordered</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {grouped.map(([color, colorLines]) =>
              colorLines.map((l, idx) => {
                const order = l.inventory_orders
                return (
                  <Table.Row
                    key={l.id}
                    className={order?.id ? "cursor-pointer" : undefined}
                    onClick={() =>
                      order?.id && navigate(`/orders/inventory/${order.id}`)
                    }
                  >
                    <Table.Cell>
                      {idx === 0 ? (
                        <Badge size="small" color="grey">{color}</Badge>
                      ) : (
                        ""
                      )}
                    </Table.Cell>
                    <Table.Cell className="text-ui-fg-subtle">
                      {order?.id ? `#${order.id.slice(-8)}` : "—"}
                    </Table.Cell>
                    <Table.Cell>
                      {order?.status ? (
                        <Badge size="small" color={STATUS_COLOR[order.status] || "grey"}>
                          {order.status}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </Table.Cell>
                    <Table.Cell>{l.quantity}</Table.Cell>
                    <Table.Cell className="text-ui-fg-subtle">
                      {order?.order_date
                        ? new Date(order.order_date).toLocaleDateString()
                        : "—"}
                    </Table.Cell>
                  </Table.Row>
                )
              })
            )}
          </Table.Body>
        </Table>
      )}
    </Container>
  )
}

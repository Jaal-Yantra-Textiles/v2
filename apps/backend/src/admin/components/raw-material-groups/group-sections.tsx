import {
  Badge,
  Button,
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
  Textarea,
  FocusModal,
  createDataTableColumnHelper,
  toast,
  useDataTable,
} from "@medusajs/ui"
import { PencilSquare, Plus, Component as ComponentIcon, Link as LinkIcon } from "@medusajs/icons"
import { useCallback, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"

import { ActionMenu } from "../common/action-menu"
import {
  RawMaterialGroup,
  RawMaterialGroupColor,
  useAddGroupColor,
  useLinkGroupColors,
  useCreateGroupOrder,
  useRawMaterialGroupOrders,
  useUpdateRawMaterialGroup,
} from "../../hooks/api/raw-material-groups"
import { useInventoryWithRawMaterials } from "../../hooks/api/raw-materials"
import { useStockLocations } from "../../hooks/api/stock_location"
import { useDebouncedSearch } from "../../hooks/use-debounce"

// ---------------------------------------------------------------------------
// General section
// ---------------------------------------------------------------------------

export const GroupGeneralSection = ({ group }: { group: RawMaterialGroup }) => {
  const { stock_locations = [] } = useStockLocations()
  const locationName =
    stock_locations.find((sl: any) => sl.id === group.stock_location_id)?.name ||
    group.stock_location_id ||
    "—"

  const cost =
    group.unit_cost != null
      ? `${group.unit_cost}${group.cost_currency ? ` ${group.cost_currency.toUpperCase()}` : ""}`
      : "—"

  // #829 — these are the "global" specs new colors inherit fill-blank.
  const rows: Array<[string, React.ReactNode]> = [
    ["Composition", group.composition || "—"],
    ["Unit of measure", group.unit_of_measure || "—"],
    ["Material type", group.material_type?.name || "—"],
    ["Default location", locationName],
    ["Default cost", cost],
    ["Lead time (days)", group.lead_time_days ?? "—"],
    ["Min. order qty", group.minimum_order_quantity ?? "—"],
    ["Colors", group.raw_materials?.length ?? 0],
  ]

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading>{group.name}</Heading>
        <div className="flex items-center gap-x-2">
          <Badge
            size="small"
            color={group.status === "Active" || !group.status ? "green" : "grey"}
          >
            {group.status || "Active"}
          </Badge>
          <EditGroupModal group={group} locations={stock_locations} />
        </div>
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
// Edit group globals (#829) — set once, inherited fill-blank by new colors.
// ---------------------------------------------------------------------------

const UNIT_OPTIONS = ["Meter", "Yard", "Kilogram", "Gram", "Piece", "Roll", "Other"]
const STATUS_OPTIONS = ["Active", "Discontinued", "Under_Review", "Development"]

const EditGroupModal = ({
  group,
  locations,
}: {
  group: RawMaterialGroup
  locations: any[]
}) => {
  const [open, setOpen] = useState(false)
  const { mutateAsync, isPending } = useUpdateRawMaterialGroup(group.id)

  const [name, setName] = useState(group.name || "")
  const [status, setStatus] = useState(group.status || "Active")
  const [composition, setComposition] = useState(group.composition || "")
  const [unit, setUnit] = useState(group.unit_of_measure || "Other")
  const [locationId, setLocationId] = useState(group.stock_location_id || "")
  const [unitCost, setUnitCost] = useState(
    group.unit_cost != null ? String(group.unit_cost) : ""
  )
  const [currency, setCurrency] = useState(group.cost_currency || "")
  const [leadTime, setLeadTime] = useState(
    group.lead_time_days != null ? String(group.lead_time_days) : ""
  )
  const [moq, setMoq] = useState(
    group.minimum_order_quantity != null
      ? String(group.minimum_order_quantity)
      : ""
  )
  const [specs, setSpecs] = useState(
    group.specifications ? JSON.stringify(group.specifications, null, 2) : ""
  )

  const onSubmit = async () => {
    if (!name.trim()) {
      toast.error("Name is required")
      return
    }
    let specifications: Record<string, unknown> | undefined
    if (specs.trim()) {
      try {
        specifications = JSON.parse(specs)
      } catch {
        toast.error("Specifications must be valid JSON")
        return
      }
    }

    const body: Record<string, unknown> = {
      name: name.trim(),
      status,
      composition: composition.trim() || undefined,
      unit_of_measure: unit,
      stock_location_id: locationId || undefined,
      unit_cost: unitCost !== "" ? Number(unitCost) : undefined,
      cost_currency: currency.trim() || undefined,
      lead_time_days: leadTime !== "" ? Number(leadTime) : undefined,
      minimum_order_quantity: moq !== "" ? Number(moq) : undefined,
      ...(specifications ? { specifications } : {}),
    }

    try {
      await mutateAsync(body)
      toast.success("Group updated")
      setOpen(false)
    } catch (e: any) {
      toast.error(e?.message || "Failed to update group")
    }
  }

  return (
    <FocusModal open={open} onOpenChange={setOpen}>
      <FocusModal.Trigger asChild>
        <Button size="small" variant="secondary" type="button">
          <PencilSquare className="text-ui-fg-subtle" />
          Edit
        </Button>
      </FocusModal.Trigger>
      <FocusModal.Content>
        <FocusModal.Header>
          <FocusModal.Title asChild>
            <Heading>Edit group globals</Heading>
          </FocusModal.Title>
          <Button size="small" onClick={onSubmit} isLoading={isPending} type="button">
            Save
          </Button>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-col items-center overflow-y-auto py-8">
          <div className="flex w-full max-w-2xl flex-col gap-y-4">
            <Text size="small" className="text-ui-fg-subtle">
              These specs are set once for the group. New colors inherit any field
              they don't already have (fill-blank). To push changes onto colors
              that already exist, run Settings → Data Plumbing →
              &ldquo;Backfill group globals to colors&rdquo;.
            </Text>

            <div className="flex flex-col gap-y-1">
              <Label size="small">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-y-1">
                <Label size="small">Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <Select.Trigger>
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    {STATUS_OPTIONS.map((s) => (
                      <Select.Item key={s} value={s}>
                        {s.replace("_", " ")}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </div>
              <div className="flex flex-col gap-y-1">
                <Label size="small">Unit of measure</Label>
                <Select value={unit} onValueChange={setUnit}>
                  <Select.Trigger>
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    {UNIT_OPTIONS.map((u) => (
                      <Select.Item key={u} value={u}>
                        {u}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-y-1">
              <Label size="small">Composition</Label>
              <Input
                value={composition}
                onChange={(e) => setComposition(e.target.value)}
                placeholder="e.g. 100% Cotton"
              />
            </div>

            <div className="flex flex-col gap-y-1">
              <Label size="small">Default receiving location</Label>
              <Select value={locationId} onValueChange={setLocationId}>
                <Select.Trigger>
                  <Select.Value placeholder="Select a location" />
                </Select.Trigger>
                <Select.Content>
                  {locations.map((sl: any) => (
                    <Select.Item key={sl.id} value={sl.id}>
                      {sl.name}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-y-1">
                <Label size="small">Default unit cost</Label>
                <Input
                  type="number"
                  value={unitCost}
                  onChange={(e) => setUnitCost(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-y-1">
                <Label size="small">Currency</Label>
                <Input
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  placeholder="e.g. inr"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-y-1">
                <Label size="small">Lead time (days)</Label>
                <Input
                  type="number"
                  value={leadTime}
                  onChange={(e) => setLeadTime(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-y-1">
                <Label size="small">Minimum order quantity</Label>
                <Input
                  type="number"
                  value={moq}
                  onChange={(e) => setMoq(e.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-col gap-y-1">
              <Label size="small">Specifications (JSON)</Label>
              <Textarea
                value={specs}
                onChange={(e) => setSpecs(e.target.value)}
                rows={5}
                placeholder='{ "gsm": 120, "weave": "poplin" }'
              />
            </div>
          </div>
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
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

type LineDraft = { quantity: string; price: string }

// Self-contained numeric input so per-row edits keep focus across DataTable
// re-renders; the value is lifted to the parent's drafts on change.
const NumberCell = ({
  initial,
  placeholder,
  onChange,
}: {
  initial: string
  placeholder: string
  onChange: (v: string) => void
}) => {
  const [v, setV] = useState(initial)
  return (
    <Input
      type="number"
      min="0"
      placeholder={placeholder}
      value={v}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        setV(e.target.value)
        onChange(e.target.value)
      }}
    />
  )
}

const orderColumnHelper = createDataTableColumnHelper<RawMaterialGroupColor>()

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
  const [rowSelection, setRowSelection] = useState<DataTableRowSelectionState>({})
  const { stock_locations = [] } = useStockLocations()
  const { mutateAsync, isPending } = useCreateGroupOrder(groupId)

  const setDraft = useCallback(
    (id: string, patch: Partial<LineDraft>) =>
      setDrafts((d) => ({
        ...d,
        [id]: { quantity: "", price: "", ...d[id], ...patch },
      })),
    []
  )

  const columns = useMemo(
    () => [
      orderColumnHelper.select(),
      orderColumnHelper.accessor("color", {
        header: "Color",
        cell: ({ row }) => row.original.color || row.original.name,
      }),
      orderColumnHelper.display({
        id: "quantity",
        header: "Quantity",
        cell: ({ row }) => (
          <NumberCell
            initial={drafts[row.original.id]?.quantity ?? ""}
            placeholder="0"
            onChange={(v) => setDraft(row.original.id, { quantity: v })}
          />
        ),
      }),
      orderColumnHelper.display({
        id: "price",
        header: "Unit price",
        cell: ({ row }) => (
          <NumberCell
            initial={drafts[row.original.id]?.price ?? ""}
            placeholder="0"
            onChange={(v) => setDraft(row.original.id, { price: v })}
          />
        ),
      }),
    ],
    // `drafts` intentionally omitted: NumberCell owns its live value, we only
    // need the initial when the modal (re)opens. Depending on drafts here would
    // recreate the cells on every keystroke and drop focus.
    [setDraft]
  )

  const table = useDataTable({
    columns,
    data: colors,
    getRowId: (row) => row.id,
    rowCount: colors.length,
    rowSelection: {
      state: rowSelection,
      onRowSelectionChange: setRowSelection,
    },
  })

  const submit = async () => {
    const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id])
    const lines = selectedIds.map((id) => ({
      raw_material_id: id,
      quantity: Number(drafts[id]?.quantity) || 0,
      price: Number(drafts[id]?.price) || 0,
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
      setRowSelection({})
    } catch (e: any) {
      toast.error(e?.message || "Failed to place order")
    }
  }

  return (
    <FocusModal open={open} onOpenChange={onOpenChange}>
      <FocusModal.Content className="flex flex-col">
        <FocusModal.Header>
          <Button size="small" onClick={submit} isLoading={isPending}>Place order</Button>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-1 flex-col overflow-hidden p-0">
          <DataTable instance={table}>
            <DataTable.Toolbar className="flex flex-col items-start gap-y-3 px-6 py-4">
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
              <div className="flex w-full max-w-sm flex-col gap-y-2">
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
            </DataTable.Toolbar>
            <DataTable.Table />
          </DataTable>
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

import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Label,
  Table,
  Text,
  FocusModal,
  Select,
  Checkbox,
  Skeleton,
  toast,
} from "@medusajs/ui"
import { useMemo, useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import {
  useRawMaterialGroup,
  useAddGroupColor,
  useCreateGroupOrder,
  type RawMaterialGroupColor,
} from "../../../hooks/api/raw-material-groups"
import { useStockLocations } from "../../../hooks/api/stock_location"

const AddColorModal = ({ groupId }: { groupId: string }) => {
  const [open, setOpen] = useState(false)
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
      setOpen(false)
      setName("")
      setColor("")
    } catch (e: any) {
      toast.error(e?.message || "Failed to add color")
    }
  }

  return (
    <FocusModal open={open} onOpenChange={setOpen}>
      <FocusModal.Trigger asChild>
        <Button size="small" variant="secondary">Add color</Button>
      </FocusModal.Trigger>
      <FocusModal.Content>
        <FocusModal.Header>
          <Button size="small" onClick={submit} isLoading={isPending}>Save</Button>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-col items-center py-16">
          <div className="flex w-full max-w-lg flex-col gap-y-6">
            <Heading>Add a color</Heading>
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

type LineDraft = { selected: boolean; quantity: string; price: string }

const OrderInColorsModal = ({
  groupId,
  colors,
}: {
  groupId: string
  colors: RawMaterialGroupColor[]
}) => {
  const [open, setOpen] = useState(false)
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
      setOpen(false)
      setDrafts({})
    } catch (e: any) {
      toast.error(e?.message || "Failed to place order")
    }
  }

  return (
    <FocusModal open={open} onOpenChange={setOpen}>
      <FocusModal.Trigger asChild>
        <Button size="small" disabled={!colors.length}>Order in colors</Button>
      </FocusModal.Trigger>
      <FocusModal.Content>
        <FocusModal.Header>
          <Button size="small" onClick={submit} isLoading={isPending}>Place order</Button>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-col items-center py-16">
          <div className="flex w-full max-w-2xl flex-col gap-y-6">
            <div>
              <Heading>Order this group in colors</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                One order line per selected color. Colors without stock are created automatically.
              </Text>
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

const RawMaterialGroupDetailPage = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data, isLoading } = useRawMaterialGroup(id)
  const group = data?.raw_material_group
  const colors = useMemo(() => group?.raw_materials ?? [], [group])

  if (isLoading) {
    return (
      <Container className="p-6">
        <Skeleton className="mb-4 h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </Container>
    )
  }

  if (!group) {
    return (
      <Container className="p-6">
        <Text className="text-ui-fg-subtle">Group not found.</Text>
      </Container>
    )
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h1">{group.name}</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {group.composition || "—"}
          </Text>
        </div>
        <div className="flex items-center gap-x-2">
          <AddColorModal groupId={group.id} />
          <OrderInColorsModal groupId={group.id} colors={colors} />
        </div>
      </div>

      <div className="px-2 py-2">
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
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {colors.map((c) => (
                <Table.Row
                  key={c.id}
                  className={c.inventory_item?.id ? "cursor-pointer" : undefined}
                  onClick={() =>
                    c.inventory_item?.id && navigate(`/inventory/${c.inventory_item.id}`)
                  }
                >
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
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </div>
    </Container>
  )
}

export default RawMaterialGroupDetailPage

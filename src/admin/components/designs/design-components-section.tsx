import { Container, Heading, Text, Badge, Button, Input, Select, toast } from "@medusajs/ui"
import { Link, useNavigate } from "react-router-dom"
import { Plus, Trash, TriangleRightMini } from "@medusajs/icons"
import { useState } from "react"
import { ActionMenu } from "../common/action-menu"
import {
  AdminDesign,
  useDesignComponents,
  useDesignUsedIn,
  useAddDesignComponent,
  useRemoveDesignComponent,
  DesignComponentLink,
} from "../../hooks/api/designs"
import { useDesigns } from "../../hooks/api/designs"

interface DesignComponentsSectionProps {
  design: AdminDesign
}

const ROLE_OPTIONS = [
  { label: "Embroidery", value: "embroidery" },
  { label: "Lining", value: "lining" },
  { label: "Trim", value: "trim" },
  { label: "Main Fabric", value: "main_fabric" },
  { label: "Print", value: "print" },
  { label: "Patch", value: "patch" },
  { label: "Other", value: "other" },
]

const AddComponentForm = ({
  designId,
  onClose,
}: {
  designId: string
  onClose: () => void
}) => {
  const [search, setSearch] = useState("")
  const [selectedDesignId, setSelectedDesignId] = useState("")
  const [quantity, setQuantity] = useState(1)
  const [role, setRole] = useState("")
  const [notes, setNotes] = useState("")

  const { designs } = useDesigns({ q: search || undefined, limit: 20 })
  const { mutateAsync: addComponent, isPending } = useAddDesignComponent(designId)

  const handleAdd = async () => {
    if (!selectedDesignId) {
      toast.error("Please select a design")
      return
    }
    try {
      await addComponent({
        component_design_id: selectedDesignId,
        quantity,
        role: role || undefined,
        notes: notes || undefined,
      })
      toast.success("Component added")
      onClose()
    } catch (e: any) {
      toast.error(e?.message || "Failed to add component")
    }
  }

  const filteredDesigns = designs.filter((d) => d.id !== designId)

  return (
    <div className="border-t border-ui-border-base px-6 py-4 flex flex-col gap-3">
      <Text size="small" className="font-medium text-ui-fg-base">Add Component Design</Text>

      <div>
        <Text size="xsmall" className="text-ui-fg-subtle mb-1">Search design</Text>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name..." size="small" />
      </div>

      {filteredDesigns.length > 0 && (
        <div>
          <Text size="xsmall" className="text-ui-fg-subtle mb-1">Select design</Text>
          <Select value={selectedDesignId} onValueChange={setSelectedDesignId}>
            <Select.Trigger size="small"><Select.Value placeholder="Select a design..." /></Select.Trigger>
            <Select.Content>
              {filteredDesigns.map((d) => (
                <Select.Item key={d.id} value={d.id}>{d.name}</Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Text size="xsmall" className="text-ui-fg-subtle mb-1">Quantity</Text>
          <Input type="number" size="small" min={1} value={String(quantity)} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))} />
        </div>
        <div>
          <Text size="xsmall" className="text-ui-fg-subtle mb-1">Role</Text>
          <Select value={role} onValueChange={setRole}>
            <Select.Trigger size="small"><Select.Value placeholder="Optional role..." /></Select.Trigger>
            <Select.Content>
              {ROLE_OPTIONS.map((r) => <Select.Item key={r.value} value={r.value}>{r.label}</Select.Item>)}
            </Select.Content>
          </Select>
        </div>
      </div>

      <div>
        <Text size="xsmall" className="text-ui-fg-subtle mb-1">Notes</Text>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes..." size="small" />
      </div>

      <div className="flex gap-2">
        <Button size="small" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="small" onClick={handleAdd} isLoading={isPending} disabled={!selectedDesignId}>Add</Button>
      </div>
    </div>
  )
}

const ComponentRow = ({ item, designId }: { item: DesignComponentLink; designId: string }) => {
  const { mutateAsync: remove, isPending } = useRemoveDesignComponent(designId)
  const design = item.component_design
  const name = design?.name || item.component_design_id
  const status = design?.status

  const handleRemove = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      await remove(item.id)
      toast.success("Component removed")
    } catch (e: any) {
      toast.error(e?.message || "Failed to remove component")
    }
  }

  return (
    <div className="shadow-elevation-card-rest bg-ui-bg-component rounded-md px-4 py-3 transition-colors hover:bg-ui-bg-component-hover">
      <div className="flex items-start justify-between gap-2">
        <Link to={`/designs/${item.component_design_id}`} className="flex-1 min-w-0 outline-none">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-ui-fg-base font-medium truncate">{name}</span>
            {item.role && <Badge size="2xsmall" color="grey">{item.role}</Badge>}
            {status && <Badge size="2xsmall" color="grey">{status}</Badge>}
          </div>
          {item.notes && <Text size="xsmall" className="text-ui-fg-subtle mt-0.5 truncate">{item.notes}</Text>}
        </Link>
        <div className="flex items-center gap-2 shrink-0">
          <Badge size="2xsmall">×{item.quantity}</Badge>
          <Button size="small" variant="transparent" isLoading={isPending} onClick={handleRemove}>
            <Trash className="text-ui-fg-subtle" />
          </Button>
        </div>
      </div>
    </div>
  )
}

export const DesignComponentsSection = ({ design }: DesignComponentsSectionProps) => {
  const [showAddForm, setShowAddForm] = useState(false)
  const { components, isLoading } = useDesignComponents(design.id)
  const { used_in, isLoading: loadingUsedIn } = useDesignUsedIn(design.id)

  return (
    <Container className="p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Components</Heading>
          <Text className="text-ui-fg-subtle" size="small">Designs bundled into this design</Text>
        </div>
        <ActionMenu
          groups={[{ actions: [{ label: "Add component", icon: <Plus />, onClick: () => setShowAddForm(true) }] }]}
        />
      </div>

      <div className="txt-small flex flex-col gap-2 px-3 pb-3">
        {isLoading ? (
          <div className="py-4 text-center"><Text className="text-ui-fg-subtle">Loading...</Text></div>
        ) : components.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-4 gap-2">
            <Text className="text-ui-fg-subtle">No components yet</Text>
            <Button size="small" variant="secondary" onClick={() => setShowAddForm(true)}>
              <Plus className="mr-1" />Add component
            </Button>
          </div>
        ) : (
          components.slice().sort((a, b) => a.order - b.order).map((item) => (
            <ComponentRow key={item.id} item={item} designId={design.id} />
          ))
        )}
      </div>

      {showAddForm && <AddComponentForm designId={design.id} onClose={() => setShowAddForm(false)} />}

      {(loadingUsedIn || used_in.length > 0) && (
        <>
          <div className="border-t border-ui-border-base px-6 pt-4 pb-2">
            <Text size="small" className="font-medium text-ui-fg-base">Used in</Text>
            <Text size="xsmall" className="text-ui-fg-subtle">Bundles that include this design</Text>
          </div>
          <div className="txt-small flex flex-col gap-2 px-3 pb-4">
            {used_in.map((item) => {
              const parent = item.parent_design
              const name = parent?.name || item.parent_design_id
              return (
                <Link key={item.id} to={`/designs/${item.parent_design_id}`} className="outline-none focus-within:shadow-borders-interactive-with-focus rounded-md [&:hover>div]:bg-ui-bg-component-hover">
                  <div className="shadow-elevation-card-rest bg-ui-bg-component rounded-md px-4 py-2.5 transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="text-ui-fg-base font-medium flex-1 truncate">{name}</span>
                      {item.role && <Badge size="2xsmall" color="grey">{item.role}</Badge>}
                      <TriangleRightMini className="text-ui-fg-muted shrink-0" />
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        </>
      )}
    </Container>
  )
}

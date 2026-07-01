import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Swatch } from "@medusajs/icons"
import {
  Button,
  Container,
  Heading,
  Input,
  Label,
  Table,
  Text,
  Textarea,
  FocusModal,
  Badge,
  Skeleton,
  toast,
} from "@medusajs/ui"
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  useRawMaterialGroups,
  useCreateRawMaterialGroup,
} from "../../hooks/api/raw-material-groups"

const CreateGroupModal = () => {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [composition, setComposition] = useState("")
  const { mutateAsync, isPending } = useCreateRawMaterialGroup()

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Name is required")
      return
    }
    try {
      await mutateAsync({ name: name.trim(), composition: composition.trim() || undefined })
      toast.success("Group created")
      setOpen(false)
      setName("")
      setComposition("")
    } catch (e: any) {
      toast.error(e?.message || "Failed to create group")
    }
  }

  return (
    <FocusModal open={open} onOpenChange={setOpen}>
      <FocusModal.Trigger asChild>
        <Button size="small" variant="secondary">Create group</Button>
      </FocusModal.Trigger>
      <FocusModal.Content>
        <FocusModal.Header>
          <Button size="small" onClick={submit} isLoading={isPending}>Save</Button>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-col items-center py-16">
          <div className="flex w-full max-w-lg flex-col gap-y-6">
            <div>
              <FocusModal.Title asChild>
                <Heading>New raw-material group</Heading>
              </FocusModal.Title>
              <FocusModal.Description asChild>
                <Text size="small" className="text-ui-fg-subtle">
                  A group ties per-color materials together (e.g. "Cotton Poplin" in blue / red / green).
                </Text>
              </FocusModal.Description>
            </div>
            <div className="flex flex-col gap-y-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Cotton Poplin" />
            </div>
            <div className="flex flex-col gap-y-2">
              <Label>Composition</Label>
              <Textarea value={composition} onChange={(e) => setComposition(e.target.value)} placeholder="100% Cotton" />
            </div>
          </div>
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
  )
}

const RawMaterialGroupsPage = () => {
  const navigate = useNavigate()
  const { data, isLoading } = useRawMaterialGroups({ limit: 50 })
  const groups = data?.raw_material_groups ?? []

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h1">Raw-material groups</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Order a material in multiple colors without losing color identity.
          </Text>
        </div>
        <CreateGroupModal />
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2 px-6 py-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : !groups.length ? (
        <div className="px-6 py-8 text-center">
          <Text className="text-ui-fg-subtle">No groups yet. Create one to get started.</Text>
        </div>
      ) : (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Name</Table.HeaderCell>
              <Table.HeaderCell>Composition</Table.HeaderCell>
              <Table.HeaderCell>Colors</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {groups.map((g) => (
              <Table.Row
                key={g.id}
                className="cursor-pointer"
                onClick={() => navigate(`/raw-material-groups/${g.id}`)}
              >
                <Table.Cell>{g.name}</Table.Cell>
                <Table.Cell className="text-ui-fg-subtle">{g.composition || "—"}</Table.Cell>
                <Table.Cell>{g.raw_materials?.length ?? 0}</Table.Cell>
                <Table.Cell>
                  <Badge size="small" color={g.status === "Active" ? "green" : "grey"}>
                    {g.status || "Active"}
                  </Badge>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Material Groups",
  icon: Swatch,
  // Nest under the core Inventory menu instead of a top-level Extensions item.
  nested: "/inventory",
})

export default RawMaterialGroupsPage

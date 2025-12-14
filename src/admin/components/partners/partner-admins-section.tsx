import {
  Badge,
  Button,
  Checkbox,
  CommandBar,
  Container,
  Drawer,
  Heading,
  Input,
  Text,
  toast,
  Table,
} from "@medusajs/ui"
import { useEffect, useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { partnersQueryKeys, useUpdatePartner } from "../../hooks/api/partners-admin"

export type AdminPartnerAdmin = {
  id: string
  email: string
  first_name?: string
  last_name?: string
  phone?: string
  role?: "owner" | "admin" | "manager"
}

export const PartnerAdminsSection = ({
  partnerId,
  admins = [] as AdminPartnerAdmin[],
}: {
  partnerId: string
  admins?: AdminPartnerAdmin[]
}) => {
  const count = admins.length

  const queryClient = useQueryClient()
  const { mutateAsync: updatePartner, isPending } = useUpdatePartner()

  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({})
  const selectedIds = useMemo(
    () => Object.keys(selectedRows).filter((k) => selectedRows[k]),
    [selectedRows]
  )
  const selectedCount = selectedIds.length
  const selectedAdminId = selectedCount === 1 ? selectedIds[0] : null
  const selectedAdmin = useMemo(
    () => admins.find((a) => a.id === selectedAdminId) || null,
    [admins, selectedAdminId]
  )

  const clearSelection = () => setSelectedRows({})

  const toggleRow = (id: string) => {
    setSelectedRows((prev) => {
      const next = { ...prev }
      next[id] = !next[id]
      if (!next[id]) {
        delete next[id]
      }
      return next
    })
  }

  const toggleAll = (checked: boolean) => {
    if (!checked) {
      clearSelection()
      return
    }
    const next = admins.reduce((acc, a) => {
      acc[a.id] = true
      return acc
    }, {} as Record<string, boolean>)
    setSelectedRows(next)
  }

  useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && selectedCount > 0) {
        clearSelection()
        event.preventDefault()
      }
    }

    if (selectedCount > 0) {
      window.addEventListener("keydown", handleEscapeKey)
    }

    return () => {
      window.removeEventListener("keydown", handleEscapeKey)
    }
  }, [selectedCount])

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")

  const openDrawer = () => {
    if (!selectedAdminId) {
      toast.error("Select exactly one admin")
      return
    }
    setPassword("")
    setConfirmPassword("")
    setDrawerOpen(true)
  }

  const closeDrawer = () => {
    setDrawerOpen(false)
  }

  const handleUpdatePassword = async () => {
    if (!selectedAdminId || !selectedAdmin) {
      toast.error("Select exactly one admin")
      return
    }

    if (!password) {
      toast.error("Password is required")
      return
    }

    if (password !== confirmPassword) {
      toast.error("Passwords do not match")
      return
    }

    try {
      await updatePartner({
        id: partnerId,
        data: {
          admin_id: selectedAdminId,
          admin_password: password,
        } as any,
      })

      toast.success("Password updated")
      closeDrawer()
      clearSelection()

      await queryClient.invalidateQueries({ queryKey: partnersQueryKeys.details() })
      await queryClient.invalidateQueries({ queryKey: partnersQueryKeys.lists() })
    } catch (e: any) {
      toast.error("Failed to update password", {
        description: e?.message || "Could not update password",
      })
    }
  }
  return (
    <Container className="divide-y p-0 w-full">
      <div className="flex items-start justify-between px-6 py-4">
        <div className="flex items-center gap-x-2">
          <Heading level="h2">Admins</Heading>
          <Badge size="2xsmall" className="ml-2">{count}</Badge>
        </div>
        <Text size="small" className="text-ui-fg-subtle">People who administer this partner</Text>
      </div>
      <div className="px-0 py-4 w-full overflow-x-auto">
        <Table className="w-full">
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell className="w-10">
                <Checkbox
                  checked={count > 0 && selectedCount === count}
                  onCheckedChange={(v) => toggleAll(!!v)}
                />
              </Table.HeaderCell>
              <Table.HeaderCell>Name</Table.HeaderCell>
              <Table.HeaderCell>Email</Table.HeaderCell>
              <Table.HeaderCell>Role</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {count === 0 ? (
              <Table.Row>
                <Table.Cell>
                  <Text size="small" className="text-ui-fg-subtle">No admins added yet.</Text>
                </Table.Cell>
                <Table.Cell />
                <Table.Cell />
              </Table.Row>
            ) : (
              admins.map((a) => (
                <Table.Row
                  key={a.id}
                  className={selectedRows[a.id] ? "bg-ui-bg-subtle" : undefined}
                  onClick={() => toggleRow(a.id)}
                >
                  <Table.Cell onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={!!selectedRows[a.id]} onCheckedChange={() => toggleRow(a.id)} />
                  </Table.Cell>
                  <Table.Cell>{[a.first_name, a.last_name].filter(Boolean).join(" ") || "—"}</Table.Cell>
                  <Table.Cell>{a.email}</Table.Cell>
                  <Table.Cell>{a.role || "admin"}</Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
      </div>

      <CommandBar open={selectedCount > 0}>
        <CommandBar.Bar>
          <CommandBar.Value>{selectedCount} selected</CommandBar.Value>
          <CommandBar.Seperator />
          <CommandBar.Command
            action={openDrawer}
            label="Update password"
            shortcut="p"
            disabled={selectedCount !== 1}
          />
          <CommandBar.Seperator />
          <CommandBar.Command action={clearSelection} label="Clear" shortcut="esc" />
        </CommandBar.Bar>
      </CommandBar>

      <Drawer open={drawerOpen} onOpenChange={(o) => (!o ? closeDrawer() : setDrawerOpen(true))}>
        <Drawer.Content className="max-w-md">
          <Drawer.Header>
            <Drawer.Title>Update password</Drawer.Title>
            <Drawer.Description>
              {selectedAdmin ? `Admin: ${selectedAdmin.email}` : "Select an admin"}
            </Drawer.Description>
          </Drawer.Header>
          <Drawer.Body className="overflow-y-auto">
            <div className="flex flex-col gap-y-4">
              <div>
                <Text size="small" className="text-ui-fg-subtle">
                  New password
                </Text>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <div>
                <Text size="small" className="text-ui-fg-subtle">
                  Confirm password
                </Text>
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
            </div>
          </Drawer.Body>
          <Drawer.Footer>
            <div className="flex w-full items-center justify-end gap-x-2">
              <Drawer.Close asChild>
                <Button variant="secondary" size="small" disabled={isPending}>
                  Cancel
                </Button>
              </Drawer.Close>
              <Button size="small" isLoading={isPending} onClick={handleUpdatePassword}>
                Save
              </Button>
            </div>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer>
    </Container>
  )
}

import {
  Badge,
  Button,
  Container,
  Drawer,
  Heading,
  Input,
  Select,
  Text,
  createDataTableColumnHelper,
  toast,
} from "@medusajs/ui"
import { Plus } from "@medusajs/icons"
import { useMemo, useState } from "react"

import { SingleColumnPage } from "../../../components/layout/pages"
import { _DataTable } from "../../../components/table/data-table"
import { useMe } from "../../../hooks/api/users"
import {
  usePartnerAdmins,
  useAddPartnerAdmin,
  PartnerAdminRecord,
} from "../../../hooks/api/partner-admins"
import { useDataTable } from "../../../hooks/use-data-table"
import { extractErrorMessage } from "../../../lib/extract-error-message"

export const SettingsPeople = () => {
  const { user, isPending: isMePending, isError, error } = useMe()
  const partnerId = user?.partner_id

  if (isError) throw error

  const { admins, count, isPending } = usePartnerAdmins({
    enabled: !!partnerId,
  })
  const { mutateAsync: addAdmin, isPending: isAdding } = useAddPartnerAdmin()

  // Add admin drawer state
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [phone, setPhone] = useState("")
  const [role, setRole] = useState<"admin" | "manager" | "owner">("admin")
  const [password, setPassword] = useState("")

  const openDrawer = () => {
    setEmail("")
    setFirstName("")
    setLastName("")
    setPhone("")
    setRole("admin")
    setPassword("")
    setDrawerOpen(true)
  }

  const handleAdd = async () => {
    if (!email.trim()) {
      toast.error("Email is required")
      return
    }

    try {
      const result = await addAdmin({
        email: email.trim(),
        first_name: firstName.trim() || undefined,
        last_name: lastName.trim() || undefined,
        phone: phone.trim() || undefined,
        role,
        password: password || undefined,
      })
      toast.success("Admin added successfully", {
        description: `Welcome email sent to ${email}. Temporary password: ${result.temp_password}`,
      })
      setDrawerOpen(false)
    } catch (e) {
      toast.error(extractErrorMessage(e, "Failed to add admin"))
    }
  }

  const columnHelper = useMemo(
    () => createDataTableColumnHelper<PartnerAdminRecord>(),
    []
  )

  const columns = useMemo(
    () => [
      columnHelper.accessor(
        (row) => {
          const name = [row.first_name, row.last_name]
            .filter(Boolean)
            .join(" ")
          return name || row.email || "-"
        },
        {
          id: "name",
          header: () => "Name",
          cell: ({ getValue, row }) => {
            const name = String(getValue() || "-")
            const r = row.original.role || "admin"
            return (
              <div className="flex flex-col">
                <Text size="small" weight="plus">
                  {name}
                </Text>
                <Text size="xsmall" className="text-ui-fg-subtle capitalize">
                  {r}
                </Text>
              </div>
            )
          },
        }
      ),
      columnHelper.accessor("email", {
        header: () => "Email",
        cell: ({ getValue }) => (
          <Text size="small">{getValue() || "-"}</Text>
        ),
      }),
      columnHelper.accessor("role", {
        header: () => "Role",
        cell: ({ getValue }) => {
          const r = getValue() || "admin"
          const color =
            r === "owner" ? "green" : r === "manager" ? "blue" : "grey"
          return (
            <Badge size="2xsmall" color={color} className="capitalize">
              {r}
            </Badge>
          )
        },
      }),
      columnHelper.accessor("created_at", {
        header: () => "Added",
        cell: ({ getValue }) => {
          const v = getValue()
          if (!v) return <Text size="small">-</Text>
          return (
            <Text size="small">
              {new Date(v).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </Text>
          )
        },
      }),
    ],
    [columnHelper]
  )

  const { table } = useDataTable({
    data: admins,
    columns,
    enablePagination: true,
    count,
    pageSize: 20,
  })

  return (
    <SingleColumnPage widgets={{ before: [], after: [] }}>
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading>Team Members</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Manage people who can access your partner dashboard.
            </Text>
          </div>
          <Button
            size="small"
            variant="secondary"
            onClick={openDrawer}
            disabled={!partnerId}
          >
            <Plus className="mr-1" />
            Add Admin
          </Button>
        </div>

        <_DataTable
          columns={columns}
          table={table}
          pagination
          count={count}
          isLoading={isPending || isMePending}
          pageSize={20}
          queryObject={{}}
          noRecords={{
            message: "No team members yet. Add your first admin above.",
          }}
        />
      </Container>

      <Drawer
        open={drawerOpen}
        onOpenChange={(o) => (!o ? setDrawerOpen(false) : null)}
      >
        <Drawer.Content className="max-w-md">
          <Drawer.Header>
            <Drawer.Title>Add Team Member</Drawer.Title>
            <Drawer.Description>
              They'll receive a welcome email with login credentials for the
              partner dashboard.
            </Drawer.Description>
          </Drawer.Header>
          <Drawer.Body className="overflow-y-auto">
            <div className="flex flex-col gap-y-4">
              <div>
                <Text size="small" weight="plus" className="mb-1">
                  Email *
                </Text>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@example.com"
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Text size="small" weight="plus" className="mb-1">
                    First name
                  </Text>
                  <Input
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="John"
                  />
                </div>
                <div>
                  <Text size="small" weight="plus" className="mb-1">
                    Last name
                  </Text>
                  <Input
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Doe"
                  />
                </div>
              </div>
              <div>
                <Text size="small" weight="plus" className="mb-1">
                  Phone
                </Text>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                  type="tel"
                />
              </div>
              <div>
                <Text size="small" weight="plus" className="mb-1">
                  Role
                </Text>
                <Select
                  value={role}
                  onValueChange={(v) => setRole(v as any)}
                >
                  <Select.Trigger>
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Item value="admin">Admin — Full access</Select.Item>
                    <Select.Item value="manager">
                      Manager — Products & orders
                    </Select.Item>
                    <Select.Item value="owner">
                      Owner — Full access + billing
                    </Select.Item>
                  </Select.Content>
                </Select>
              </div>
              <div>
                <Text size="small" weight="plus" className="mb-1">
                  Password
                </Text>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Leave blank to auto-generate"
                  autoComplete="new-password"
                />
                <Text size="xsmall" className="text-ui-fg-muted mt-1">
                  If left blank, a secure password will be generated and
                  included in the welcome email.
                </Text>
              </div>
            </div>
          </Drawer.Body>
          <Drawer.Footer>
            <div className="flex w-full items-center justify-end gap-x-2">
              <Drawer.Close asChild>
                <Button variant="secondary" size="small" disabled={isAdding}>
                  Cancel
                </Button>
              </Drawer.Close>
              <Button
                size="small"
                isLoading={isAdding}
                onClick={handleAdd}
              >
                Add Admin
              </Button>
            </div>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer>
    </SingleColumnPage>
  )
}

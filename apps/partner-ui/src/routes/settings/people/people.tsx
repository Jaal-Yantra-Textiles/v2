import {
  Badge,
  Button,
  Checkbox,
  Container,
  Drawer,
  Heading,
  Input,
  Label,
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
  usePartnerPeople,
} from "../../../hooks/api/partner-admins"
import { useDataTable } from "../../../hooks/use-data-table"
import { extractErrorMessage } from "../../../lib/extract-error-message"
import { sdk } from "../../../lib/client"
import { queryClient } from "../../../lib/query-client"

type PersonRow = {
  id: string
  first_name?: string | null
  last_name?: string | null
  email: string
  phone?: string | null
  role?: string | null
  is_admin: boolean
  created_at?: string | null
}

export const SettingsPeople = () => {
  const { user, isPending: isMePending, isError, error } = useMe()
  const partnerId = user?.partner_id

  if (isError) throw error

  const { admins, isPending } = usePartnerAdmins({ enabled: !!partnerId })
  const { people, isPending: isPeoplePending } = usePartnerPeople(partnerId)
  const { mutateAsync: addAdmin, isPending: isAdding } = useAddPartnerAdmin()

  // Merge admins + linked people, de-dupe by email
  const rows = useMemo<PersonRow[]>(() => {
    const adminRows: PersonRow[] = (admins || []).map((a) => ({
      id: a.id,
      first_name: a.first_name,
      last_name: a.last_name,
      email: a.email,
      phone: a.phone,
      role: a.role || "admin",
      is_admin: true,
      created_at: a.created_at,
    }))

    const peopleRows: PersonRow[] = (people || []).map((p) => ({
      id: p.id,
      first_name: p.first_name ?? (p.name ? p.name.split(" ")[0] : null),
      last_name: p.last_name ?? (p.name?.split(" ").slice(1).join(" ") || null),
      email: p.email || "",
      phone: p.phone ?? null,
      role: "person",
      is_admin: false,
      created_at: null,
    }))

    // De-dupe: admins take precedence over people with same email
    const seen = new Set(adminRows.map((a) => a.email?.toLowerCase()).filter(Boolean))
    const combined = [
      ...adminRows,
      ...peopleRows.filter(
        (p) => !p.email || !seen.has(p.email.toLowerCase())
      ),
    ]
    return combined
  }, [admins, people])

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [phone, setPhone] = useState("")
  const [role, setRole] = useState<string>("admin")
  const [password, setPassword] = useState("")
  const [createAsAdmin, setCreateAsAdmin] = useState(true)

  const openDrawer = () => {
    setEmail("")
    setFirstName("")
    setLastName("")
    setPhone("")
    setRole("admin")
    setPassword("")
    setCreateAsAdmin(true)
    setDrawerOpen(true)
  }

  const handleAdd = async () => {
    if (!email.trim()) {
      toast.error("Email is required")
      return
    }

    if (createAsAdmin) {
      // Create via API — registers auth credentials + sends email
      try {
        const result = await addAdmin({
          email: email.trim(),
          first_name: firstName.trim() || undefined,
          last_name: lastName.trim() || undefined,
          phone: phone.trim() || undefined,
          role: role as "admin" | "manager" | "owner",
          password: password || undefined,
        })
        toast.success("Admin added successfully", {
          description: `Welcome email sent to ${email}. Temporary password: ${result.temp_password}`,
        })
        setDrawerOpen(false)
      } catch (e) {
        toast.error(extractErrorMessage(e, "Failed to add admin"))
      }
    } else {
      // Add as a linked person via the partners/:id API
      if (!partnerId) return
      try {
        await sdk.client.fetch(`/partners/${partnerId}`, {
          method: "POST",
          body: {
            people: [
              {
                first_name: firstName.trim() || undefined,
                last_name: lastName.trim() || undefined,
                email: email.trim(),
                phone: phone.trim() || undefined,
              },
            ],
          },
        })
        toast.success("Person added", {
          description: `${email} added as ${role}. They won't have dashboard login access.`,
        })
        setDrawerOpen(false)
        queryClient.invalidateQueries({ queryKey: ["partner_people"] })
      } catch (e) {
        toast.error(extractErrorMessage(e, "Failed to add person"))
      }
    }
  }

  const columnHelper = useMemo(
    () => createDataTableColumnHelper<PersonRow>(),
    []
  )

  const columns = useMemo(
    () => [
      columnHelper.accessor(
        (row) => {
          const name = [row.first_name, row.last_name].filter(Boolean).join(" ")
          return name || row.email || "-"
        },
        {
          id: "name",
          header: () => "Name",
          cell: ({ getValue, row }) => {
            const name = String(getValue() || "-")
            const r = row.original.role || "member"
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
      columnHelper.accessor("is_admin", {
        header: () => "Access",
        cell: ({ getValue }) => {
          const isAdmin = getValue()
          return (
            <Badge
              size="2xsmall"
              color={isAdmin ? "green" : "grey"}
            >
              {isAdmin ? "Dashboard" : "Team only"}
            </Badge>
          )
        },
      }),
      columnHelper.accessor("role", {
        header: () => "Role",
        cell: ({ getValue }) => {
          const r = getValue() || "member"
          const color =
            r === "owner"
              ? "green"
              : r === "admin"
                ? "blue"
                : r === "manager"
                  ? "orange"
                  : "grey"
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
    data: rows,
    columns,
    enablePagination: true,
    count: rows.length,
    pageSize: 20,
  })

  return (
    <SingleColumnPage widgets={{ before: [], after: [] }}>
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading>Team Members</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Manage people in your organization. Admins can log in to the
              dashboard.
            </Text>
          </div>
          <Button
            size="small"
            variant="secondary"
            onClick={openDrawer}
            disabled={!partnerId}
          >
            <Plus className="mr-1" />
            Add Person
          </Button>
        </div>

        <_DataTable
          columns={columns}
          table={table}
          pagination
          count={rows.length}
          isLoading={isPending || isPeoplePending || isMePending}
          pageSize={20}
          queryObject={{}}
          noRecords={{
            message: "No team members yet. Add your first person above.",
          }}
        />
      </Container>

      <Drawer
        open={drawerOpen}
        onOpenChange={(o) => (!o ? setDrawerOpen(false) : null)}
      >
        <Drawer.Content className="max-w-md">
          <Drawer.Header>
            <Drawer.Title>Add Person</Drawer.Title>
            <Drawer.Description>
              Add a team member to your organization.
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
                  placeholder="person@example.com"
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

              {/* Dashboard admin checkbox */}
              <div className="flex items-start gap-x-3 rounded-lg border border-ui-border-base p-4">
                <Checkbox
                  id="create-as-admin"
                  checked={createAsAdmin}
                  onCheckedChange={(v) => setCreateAsAdmin(!!v)}
                />
                <div>
                  <Label
                    htmlFor="create-as-admin"
                    className="cursor-pointer font-medium"
                  >
                    Create as dashboard admin
                  </Label>
                  <Text size="xsmall" className="text-ui-fg-subtle mt-0.5">
                    {createAsAdmin
                      ? "This person will receive login credentials and can access the partner dashboard."
                      : "This person will be listed as a team member but won't have dashboard access."}
                  </Text>
                </div>
              </div>

              {createAsAdmin && (
                <>
                  <div>
                    <Text size="small" weight="plus" className="mb-1">
                      Role
                    </Text>
                    <Select
                      value={role}
                      onValueChange={setRole}
                    >
                      <Select.Trigger>
                        <Select.Value />
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Item value="admin">
                          Admin — Full access
                        </Select.Item>
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
                      Auto-generated if left blank. Included in the welcome
                      email.
                    </Text>
                  </div>
                </>
              )}

              {!createAsAdmin && (
                <div>
                  <Text size="small" weight="plus" className="mb-1">
                    Role
                  </Text>
                  <Input
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    placeholder="e.g. Designer, Weaver, QA"
                  />
                  <Text size="xsmall" className="text-ui-fg-muted mt-1">
                    Free-text role for organizational purposes.
                  </Text>
                </div>
              )}
            </div>
          </Drawer.Body>
          <Drawer.Footer>
            <div className="flex w-full items-center justify-end gap-x-2">
              <Drawer.Close asChild>
                <Button
                  variant="secondary"
                  size="small"
                  disabled={isAdding}
                >
                  Cancel
                </Button>
              </Drawer.Close>
              <Button
                size="small"
                isLoading={isAdding}
                onClick={handleAdd}
              >
                {createAsAdmin ? "Add Admin" : "Add Person"}
              </Button>
            </div>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer>
    </SingleColumnPage>
  )
}

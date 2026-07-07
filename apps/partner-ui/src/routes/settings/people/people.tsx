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
import { useTranslation } from "react-i18next"

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
  const { t } = useTranslation()
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
      toast.error(t("partner.people.toast.emailRequired"))
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
        toast.success(t("partner.people.toast.adminAdded"), {
          description: t("partner.people.toast.adminAddedDescription", {
            email,
            password: result.temp_password,
          }),
        })
        setDrawerOpen(false)
      } catch (e) {
        toast.error(extractErrorMessage(e, t("partner.people.toast.addAdminFailed")))
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
        toast.success(t("partner.people.toast.personAdded"), {
          description: t("partner.people.toast.personAddedDescription", {
            email,
            role,
          }),
        })
        setDrawerOpen(false)
        queryClient.invalidateQueries({ queryKey: ["partner_people"] })
      } catch (e) {
        toast.error(extractErrorMessage(e, t("partner.people.toast.addPersonFailed")))
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
          header: () => t("partner.people.columns.name"),
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
        header: () => t("partner.people.columns.email"),
        cell: ({ getValue }) => (
          <Text size="small">{getValue() || "-"}</Text>
        ),
      }),
      columnHelper.accessor("is_admin", {
        header: () => t("partner.people.columns.access"),
        cell: ({ getValue }) => {
          const isAdmin = getValue()
          return (
            <Badge
              size="2xsmall"
              color={isAdmin ? "green" : "grey"}
            >
              {isAdmin
                ? t("partner.people.columns.accessDashboard")
                : t("partner.people.columns.accessTeamOnly")}
            </Badge>
          )
        },
      }),
      columnHelper.accessor("role", {
        header: () => t("partner.people.columns.role"),
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
        header: () => t("partner.people.columns.added"),
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
    [columnHelper, t]
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
        <div className="flex flex-col gap-y-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Heading>{t("partner.people.heading")}</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              {t("partner.people.description")}
            </Text>
          </div>
          <Button
            size="small"
            variant="secondary"
            onClick={openDrawer}
            disabled={!partnerId}
          >
            <Plus className="mr-1" />
            {t("partner.people.addPerson")}
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
            message: t("partner.people.empty"),
          }}
        />
      </Container>

      <Drawer
        open={drawerOpen}
        onOpenChange={(o) => (!o ? setDrawerOpen(false) : null)}
      >
        <Drawer.Content className="max-w-md">
          <Drawer.Header>
            <Drawer.Title>{t("partner.people.drawer.title")}</Drawer.Title>
            <Drawer.Description>
              {t("partner.people.drawer.description")}
            </Drawer.Description>
          </Drawer.Header>
          <Drawer.Body className="overflow-y-auto">
            <div className="flex flex-col gap-y-4">
              <div>
                <Text size="small" weight="plus" className="mb-1">
                  {t("partner.people.drawer.emailLabel")}
                </Text>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("partner.people.drawer.emailPlaceholder")}
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Text size="small" weight="plus" className="mb-1">
                    {t("partner.people.drawer.firstName")}
                  </Text>
                  <Input
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder={t("partner.people.drawer.firstNamePlaceholder")}
                  />
                </div>
                <div>
                  <Text size="small" weight="plus" className="mb-1">
                    {t("partner.people.drawer.lastName")}
                  </Text>
                  <Input
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder={t("partner.people.drawer.lastNamePlaceholder")}
                  />
                </div>
              </div>
              <div>
                <Text size="small" weight="plus" className="mb-1">
                  {t("partner.people.drawer.phone")}
                </Text>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={t("partner.people.drawer.phonePlaceholder")}
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
                    {t("partner.people.drawer.createAsAdmin")}
                  </Label>
                  <Text size="xsmall" className="text-ui-fg-subtle mt-0.5">
                    {createAsAdmin
                      ? t("partner.people.drawer.adminHint")
                      : t("partner.people.drawer.teamHint")}
                  </Text>
                </div>
              </div>

              {createAsAdmin && (
                <>
                  <div>
                    <Text size="small" weight="plus" className="mb-1">
                      {t("partner.people.drawer.role")}
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
                          {t("partner.people.drawer.roleAdmin")}
                        </Select.Item>
                        <Select.Item value="manager">
                          {t("partner.people.drawer.roleManager")}
                        </Select.Item>
                        <Select.Item value="owner">
                          {t("partner.people.drawer.roleOwner")}
                        </Select.Item>
                      </Select.Content>
                    </Select>
                  </div>
                  <div>
                    <Text size="small" weight="plus" className="mb-1">
                      {t("partner.people.drawer.password")}
                    </Text>
                    <Input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t("partner.people.drawer.passwordPlaceholder")}
                      autoComplete="new-password"
                    />
                    <Text size="xsmall" className="text-ui-fg-muted mt-1">
                      {t("partner.people.drawer.passwordHint")}
                    </Text>
                  </div>
                </>
              )}

              {!createAsAdmin && (
                <div>
                  <Text size="small" weight="plus" className="mb-1">
                    {t("partner.people.drawer.freeTextRole")}
                  </Text>
                  <Input
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    placeholder={t("partner.people.drawer.freeTextRolePlaceholder")}
                  />
                  <Text size="xsmall" className="text-ui-fg-muted mt-1">
                    {t("partner.people.drawer.freeTextRoleHint")}
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
                  {t("partner.people.drawer.cancel")}
                </Button>
              </Drawer.Close>
              <Button
                size="small"
                isLoading={isAdding}
                onClick={handleAdd}
              >
                {createAsAdmin
                  ? t("partner.people.drawer.addAdmin")
                  : t("partner.people.addPerson")}
              </Button>
            </div>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer>
    </SingleColumnPage>
  )
}

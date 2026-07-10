import { defineRouteConfig } from "@medusajs/admin-sdk"
import { BuildingStorefront } from "@medusajs/icons"
import {
  Container,
  Heading,
  Text,
  Input,
  Label,
  FocusModal,
  Button,
  DataTable,
  useDataTable,
  createDataTableColumnHelper,
  DataTablePaginationState,
  toast,
} from "@medusajs/ui"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "@medusajs/framework/zod"
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  useCompanies,
  useCreateCompany,
  type AdminCompany,
  type CreateCompanyPayload,
} from "../../hooks/api/companies-admin"

const columnHelper = createDataTableColumnHelper<AdminCompany>()

const columns = [
  columnHelper.accessor("name", { header: "Name" }),
  columnHelper.accessor("email", { header: "Email" }),
  columnHelper.accessor("industry", {
    header: "Industry",
    cell: ({ row }) => row.original.industry || "—",
  }),
]

const companySchema = z.object({
  name: z.string().min(1, "Name is required"),
  legal_name: z.string().min(1, "Legal name is required"),
  email: z.string().email("Invalid email"),
  phone: z.string().min(1, "Phone is required"),
  address: z.string().min(1, "Address is required"),
  city: z.string().min(1, "City is required"),
  state: z.string().min(1, "State is required"),
  country: z.string().min(1, "Country is required"),
  postal_code: z.string().min(1, "Postal code is required"),
  website: z.string().optional(),
  industry: z.string().optional(),
  description: z.string().optional(),
})

const CreateCompanyModal = () => {
  const [open, setOpen] = useState(false)

  const form = useForm({
    resolver: zodResolver(companySchema),
    mode: "onChange",
    defaultValues: {
      name: "",
      legal_name: "",
      email: "",
      phone: "",
      address: "",
      city: "",
      state: "",
      country: "",
      postal_code: "",
      website: "",
      industry: "",
      description: "",
    },
  })

  const { mutateAsync, isPending } = useCreateCompany({
    onSuccess: () => {
      toast.success("Company created")
      form.reset()
      setOpen(false)
    },
    onError: (err) => {
      toast.error(err?.message || "Failed to create company")
    },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    await mutateAsync(values as unknown as CreateCompanyPayload)
  })

  return (
    <FocusModal open={open} onOpenChange={setOpen}>
      <FocusModal.Trigger asChild>
        <Button size="small" variant="secondary">
          Create company
        </Button>
      </FocusModal.Trigger>
      <FocusModal.Content>
        <FocusModal.Header>
          <Button size="small" isLoading={isPending} onClick={onSubmit}>
            Create
          </Button>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-col items-center overflow-y-auto py-8">
          <form
            onSubmit={onSubmit}
            className="flex w-full max-w-lg flex-col gap-y-6"
          >
            <div className="flex flex-col gap-y-1">
              <Heading level="h2">Create a company</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                Add a new company to the platform.
              </Text>
            </div>

            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">
                Name
              </Label>
              <Input placeholder="Acme Corp" {...form.register("name")} />
              {form.formState.errors.name && (
                <Text size="small" className="text-ui-fg-error">
                  {form.formState.errors.name.message}
                </Text>
              )}
            </div>

            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">
                Legal name
              </Label>
              <Input
                placeholder="Acme Corp LLC"
                {...form.register("legal_name")}
              />
              {form.formState.errors.legal_name && (
                <Text size="small" className="text-ui-fg-error">
                  {form.formState.errors.legal_name.message}
                </Text>
              )}
            </div>

            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">
                Email
              </Label>
              <Input
                type="email"
                placeholder="contact@acme.com"
                {...form.register("email")}
              />
              {form.formState.errors.email && (
                <Text size="small" className="text-ui-fg-error">
                  {form.formState.errors.email.message}
                </Text>
              )}
            </div>

            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">
                Phone
              </Label>
              <Input placeholder="+1 555 0100" {...form.register("phone")} />
              {form.formState.errors.phone && (
                <Text size="small" className="text-ui-fg-error">
                  {form.formState.errors.phone.message}
                </Text>
              )}
            </div>

            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">
                Address
              </Label>
              <Input
                placeholder="123 Main St"
                {...form.register("address")}
              />
              {form.formState.errors.address && (
                <Text size="small" className="text-ui-fg-error">
                  {form.formState.errors.address.message}
                </Text>
              )}
            </div>

            <div className="grid grid-cols-2 gap-x-3">
              <div className="flex flex-col gap-y-2">
                <Label size="small" weight="plus">
                  City
                </Label>
                <Input placeholder="New York" {...form.register("city")} />
                {form.formState.errors.city && (
                  <Text size="small" className="text-ui-fg-error">
                    {form.formState.errors.city.message}
                  </Text>
                )}
              </div>
              <div className="flex flex-col gap-y-2">
                <Label size="small" weight="plus">
                  State
                </Label>
                <Input placeholder="NY" {...form.register("state")} />
                {form.formState.errors.state && (
                  <Text size="small" className="text-ui-fg-error">
                    {form.formState.errors.state.message}
                  </Text>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-3">
              <div className="flex flex-col gap-y-2">
                <Label size="small" weight="plus">
                  Country
                </Label>
                <Input placeholder="United States" {...form.register("country")} />
                {form.formState.errors.country && (
                  <Text size="small" className="text-ui-fg-error">
                    {form.formState.errors.country.message}
                  </Text>
                )}
              </div>
              <div className="flex flex-col gap-y-2">
                <Label size="small" weight="plus">
                  Postal code
                </Label>
                <Input placeholder="10001" {...form.register("postal_code")} />
                {form.formState.errors.postal_code && (
                  <Text size="small" className="text-ui-fg-error">
                    {form.formState.errors.postal_code.message}
                  </Text>
                )}
              </div>
            </div>

            <div className="bg-ui-border-base h-px w-full" />

            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">
                Website (optional)
              </Label>
              <Input
                placeholder="https://acme.com"
                {...form.register("website")}
              />
            </div>

            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">
                Industry (optional)
              </Label>
              <Input
                placeholder="Textiles"
                {...form.register("industry")}
              />
            </div>

            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">
                Description (optional)
              </Label>
              <Input
                placeholder="Brief description"
                {...form.register("description")}
              />
            </div>
          </form>
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
  )
}

const CompaniesPage = () => {
  const navigate = useNavigate()

  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageSize: 20,
    pageIndex: 0,
  })

  const offset = pagination.pageIndex * pagination.pageSize

  const { companies = [], count = 0, isPending } = useCompanies({
    limit: pagination.pageSize,
    offset,
  })

  const table = useDataTable({
    data: companies,
    columns,
    getRowId: (row) => row.id,
    onRowClick: (_event, row) => navigate(`/companies/${row.id}`),
    rowCount: count,
    isLoading: isPending,
    pagination: {
      state: pagination,
      onPaginationChange: setPagination,
    },
  })

  return (
    <Container className="divide-y p-0">
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex items-center justify-between px-6 py-4">
          <Heading>Companies</Heading>
          <CreateCompanyModal />
        </DataTable.Toolbar>
        <DataTable.Table />
      </DataTable>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Companies",
  icon: BuildingStorefront,
})

export default CompaniesPage

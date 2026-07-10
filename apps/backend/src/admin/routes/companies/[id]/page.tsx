import {
  Badge,
  Button,
  Container,
  DataTable,
  FocusModal,
  Heading,
  Input,
  Label,
  Select,
  Skeleton,
  Table,
  Text,
  toast,
  useDataTable,
} from "@medusajs/ui"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "@medusajs/framework/zod"
import { useState } from "react"
import { UIMatch, useParams } from "react-router-dom"
import {
  useCompany,
  useCompanyInvestors,
  useInviteInvestorToCompany,
  type InviteInvestorToCompanyPayload,
} from "../../../hooks/api/companies-admin"
import { CapTableSection } from "../../../components/companies/cap-table-section"
import { FinancialsSection } from "../../../components/companies/financials-section"
import { ComplianceSection } from "../../../components/companies/compliance-section"

const INVESTOR_TYPES = ["individual", "entity", "fund"] as const

const inviteSchema = z.object({
  name: z.string().min(1, "Name is required"),
  investor_type: z.enum(INVESTOR_TYPES),
  legal_name: z.string().optional(),
  admin: z.object({
    email: z.string().email("Invalid email"),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
  }),
})

const InviteInvestorModal = ({ companyId }: { companyId: string }) => {
  const [open, setOpen] = useState(false)

  const form = useForm({
    resolver: zodResolver(inviteSchema),
    mode: "onChange",
    defaultValues: {
      name: "",
      investor_type: "individual",
      legal_name: "",
      admin: { email: "", first_name: "", last_name: "" },
    },
  })

  const { mutateAsync, isPending } = useInviteInvestorToCompany(companyId, {
    onSuccess: () => {
      toast.success("Investor invited")
      form.reset()
      setOpen(false)
    },
    onError: (err) => {
      toast.error(err?.message || "Failed to invite investor")
    },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    await mutateAsync({
      ...values,
      email: values.admin.email,
    } as unknown as InviteInvestorToCompanyPayload)
  })

  return (
    <FocusModal open={open} onOpenChange={setOpen}>
      <FocusModal.Trigger asChild>
        <Button size="small" variant="secondary">
          Invite investor
        </Button>
      </FocusModal.Trigger>
      <FocusModal.Content>
        <FocusModal.Header>
          <Button size="small" isLoading={isPending} onClick={onSubmit}>
            Send invite
          </Button>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-col items-center overflow-y-auto py-8">
          <form
            onSubmit={onSubmit}
            className="flex w-full max-w-lg flex-col gap-y-6"
          >
            <div className="flex flex-col gap-y-1">
              <Heading level="h2">Invite an investor</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                Creates the investor and a login, then emails them a temporary
                password and the portal link.
              </Text>
            </div>

            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">
                Investor / entity name
              </Label>
              <Input placeholder="Acme Ventures" {...form.register("name")} />
              {form.formState.errors.name && (
                <Text size="small" className="text-ui-fg-error">
                  {form.formState.errors.name.message}
                </Text>
              )}
            </div>

            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">
                Type
              </Label>
              <Controller
                control={form.control}
                name="investor_type"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <Select.Trigger>
                      <Select.Value placeholder="Select type" />
                    </Select.Trigger>
                    <Select.Content>
                      {INVESTOR_TYPES.map((t) => (
                        <Select.Item key={t} value={t}>
                          {t}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select>
                )}
              />
            </div>

            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">
                Legal name (optional)
              </Label>
              <Input
                placeholder="Acme Ventures LLC"
                {...form.register("legal_name")}
              />
            </div>

            <div className="bg-ui-border-base h-px w-full" />

            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">
                Primary contact email
              </Label>
              <Input
                type="email"
                placeholder="jane@acme.com"
                {...form.register("admin.email")}
              />
              {form.formState.errors.admin?.email && (
                <Text size="small" className="text-ui-fg-error">
                  {form.formState.errors.admin.email.message}
                </Text>
              )}
            </div>

            <div className="grid grid-cols-2 gap-x-3">
              <div className="flex flex-col gap-y-2">
                <Label size="small" weight="plus">
                  First name
                </Label>
                <Input {...form.register("admin.first_name")} />
              </div>
              <div className="flex flex-col gap-y-2">
                <Label size="small" weight="plus">
                  Last name
                </Label>
                <Input {...form.register("admin.last_name")} />
              </div>
            </div>
          </form>
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
  )
}

const CompanyDetailPage = () => {
  const { id } = useParams()
  const { company, isPending: companyLoading } = useCompany(id!)
  const { investors = [] } = useCompanyInvestors(id!)
  const investorsTable = useDataTable({
    data: investors,
    columns: [
      {
        header: "Name",
        accessorKey: "name",
      },
      {
        header: "Type",
        accessorKey: "investor_type",
        cell: ({ row }) => (
          <Badge>{row.original.investor_type}</Badge>
        ),
      },
      {
        header: "Email",
        accessorKey: "email",
      },
      {
        header: "pipeline_stage",
        accessorKey: "pipeline_stage",
      }
    ],
    
  })

  return (
    <div className="flex flex-col gap-y-4">
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading>{company?.name}</Heading>
        </div>
        <div className="px-6 py-4">
          {companyLoading ? (
            <div className="flex flex-col gap-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
            </div>
          ) : (
            <div className="flex flex-col gap-y-3">
              <div className="flex items-center gap-x-2">
                <Text weight="plus">Email</Text>
                <Text className="text-ui-fg-subtle">
                  {company?.email || "—"}
                </Text>
              </div>
              <div className="flex items-center gap-x-2">
                <Text weight="plus">Industry</Text>
                <Text className="text-ui-fg-subtle">
                  {company?.industry || "—"}
                </Text>
              </div>
              <div className="flex items-center gap-x-2">
                <Text weight="plus">Legal name</Text>
                <Text className="text-ui-fg-subtle">
                  {company?.legal_name || "—"}
                </Text>
              </div>
            </div>
          )}
        </div>
      </Container>

      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <Heading level="h2">Investors</Heading>
          <InviteInvestorModal companyId={id!} />
        </div>
        <DataTable instance={investorsTable}>
                  <DataTable.Table />
        </DataTable>
      </Container>

      <CapTableSection companyId={id!} />
      <FinancialsSection companyId={id!} />
      <ComplianceSection companyId={id!} company={company} />
    </div>
  )
}

export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) => {
    const { id } = match.params;
    return `${id}`;
  },
};

export default CompanyDetailPage

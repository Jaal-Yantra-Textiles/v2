import { defineRouteConfig } from "@medusajs/admin-sdk"
import { CurrencyDollar } from "@medusajs/icons"
import {
  Button,
  Container,
  FocusModal,
  Heading,
  Input,
  Label,
  Select,
  Table,
  Text,
  Badge,
  toast,
} from "@medusajs/ui"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "@medusajs/framework/zod"
import { useState } from "react"
import {
  useInvestors,
  useInviteInvestor,
  type InviteInvestorPayload,
} from "../../hooks/api/investors-admin"

const INVESTOR_TYPES = ["individual", "entity", "fund"] as const

const inviteSchema = z.object({
  name: z.string().min(1, "Name is required"),
  investor_type: z.enum(INVESTOR_TYPES),
  legal_name: z.string().optional(),
  admin: z.object({
    email: z.string().email("Invalid email"),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    phone: z.string().optional(),
  }),
})

const InviteInvestorModal = () => {
  const [open, setOpen] = useState(false)

  const form = useForm({
    resolver: zodResolver(inviteSchema),
    mode: "onChange",
    defaultValues: {
      name: "",
      investor_type: "individual",
      legal_name: "",
      admin: { email: "", first_name: "", last_name: "", phone: "" },
    },
  })

  const { mutateAsync, isPending } = useInviteInvestor({
    onSuccess: () => {
      toast.success("Investor invited — an onboarding email has been sent")
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
      // Investor entity requires its own email; reuse the primary contact email.
      email: values.admin.email,
    } as unknown as InviteInvestorPayload)
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
                password and the portal link. No self-registration.
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

const InvestorsPage = () => {
  const { investors = [], count = 0, isPending } = useInvestors({ limit: 50 })

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading>Investors</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {count} investor{count === 1 ? "" : "s"} · invite-only
          </Text>
        </div>
        <InviteInvestorModal />
      </div>

      <div className="px-6 py-4">
        {isPending ? (
          <Text size="small" className="text-ui-fg-subtle">
            Loading…
          </Text>
        ) : investors.length === 0 ? (
          <Text size="small" className="text-ui-fg-subtle">
            No investors yet. Invite one to get started.
          </Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Name</Table.HeaderCell>
                <Table.HeaderCell>Type</Table.HeaderCell>
                <Table.HeaderCell>Status</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {investors.map((inv) => (
                <Table.Row key={inv.id}>
                  <Table.Cell>{inv.name}</Table.Cell>
                  <Table.Cell>{inv.investor_type ?? "—"}</Table.Cell>
                  <Table.Cell>
                    <Badge size="2xsmall">{inv.status ?? "active"}</Badge>
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

export const config = defineRouteConfig({
  label: "Investors",
  icon: CurrencyDollar,
})

export default InvestorsPage

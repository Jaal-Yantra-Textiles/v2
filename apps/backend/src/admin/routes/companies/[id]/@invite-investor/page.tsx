import {
  Button,
  Heading,
  Input,
  Label,
  Select,
  Text,
  toast,
} from "@medusajs/ui"
import { Controller, useForm } from "react-hook-form"
import { useParams } from "react-router-dom"
import { RouteFocusModal } from "../../../../components/modal/route-focus-modal"
import { useRouteModal } from "../../../../components/modal/use-route-modal"
import {
  useInviteInvestorToCompany,
  type InviteInvestorToCompanyPayload,
} from "../../../../hooks/api/companies-admin"

const INVESTOR_TYPES = ["individual", "entity", "fund"] as const

const InviteInvestorForm = ({ companyId }: { companyId: string }) => {
  const { handleSuccess } = useRouteModal()
  const form = useForm({
    defaultValues: {
      name: "",
      investor_type: "individual",
      legal_name: "",
      admin: { email: "", first_name: "", last_name: "" },
    },
  })
  const { mutateAsync, isPending } = useInviteInvestorToCompany(companyId, {
    onSuccess: (data: any) => {
      toast.success(
        data?.reinvited
          ? "Investor already existed — password reset and invite re-sent"
          : "Investor invited"
      )
      handleSuccess()
    },
    onError: (err) => toast.error(err?.message || "Failed to invite investor"),
  })
  const onSubmit = form.handleSubmit(async (values) => {
    if (!values.name.trim()) {
      toast.error("Name is required")
      return
    }
    if (!values.admin.email.trim()) {
      toast.error("Contact email is required")
      return
    }
    await mutateAsync({
      ...values,
      email: values.admin.email,
    } as unknown as InviteInvestorToCompanyPayload)
  })

  return (
    <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
      <RouteFocusModal.Header>
        <div className="flex items-center justify-end gap-x-2">
          <RouteFocusModal.Close asChild>
            <Button size="small" variant="secondary">Cancel</Button>
          </RouteFocusModal.Close>
          <Button size="small" type="submit" isLoading={isPending}>Send invite</Button>
        </div>
      </RouteFocusModal.Header>
      <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-auto py-8">
        <div className="flex w-full max-w-lg flex-col gap-y-6">
          <div className="flex flex-col gap-y-1">
            <Heading level="h2">Invite an investor</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Creates the investor and a login, then emails them a temporary
              password and the portal link.
            </Text>
          </div>

          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">Investor / entity name</Label>
            <Input placeholder="Acme Ventures" {...form.register("name")} />
          </div>

          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">Type</Label>
            <Controller
              control={form.control}
              name="investor_type"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <Select.Trigger><Select.Value placeholder="Select type" /></Select.Trigger>
                  <Select.Content>
                    {INVESTOR_TYPES.map((t) => (
                      <Select.Item key={t} value={t}>{t}</Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              )}
            />
          </div>

          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">Legal name (optional)</Label>
            <Input placeholder="Acme Ventures LLC" {...form.register("legal_name")} />
          </div>

          <div className="bg-ui-border-base h-px w-full" />

          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">Primary contact email</Label>
            <Input type="email" placeholder="jane@acme.com" {...form.register("admin.email")} />
          </div>

          <div className="grid grid-cols-2 gap-x-3">
            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">First name</Label>
              <Input {...form.register("admin.first_name")} />
            </div>
            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">Last name</Label>
              <Input {...form.register("admin.last_name")} />
            </div>
          </div>
        </div>
      </RouteFocusModal.Body>
    </form>
  )
}

const InviteInvestorPage = () => {
  const { id } = useParams()
  return (
    <RouteFocusModal>
      <InviteInvestorForm companyId={id!} />
    </RouteFocusModal>
  )
}

export default InviteInvestorPage

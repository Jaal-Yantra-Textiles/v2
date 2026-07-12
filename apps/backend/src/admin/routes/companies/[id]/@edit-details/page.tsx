import {
  Button,
  Heading,
  Input,
  Label,
  Select,
  toast,
} from "@medusajs/ui"
import { Controller, useForm } from "react-hook-form"
import { useParams } from "react-router-dom"
import { RouteDrawer } from "../../../../components/modal/route-drawer/route-drawer"
import { useRouteModal } from "../../../../components/modal/use-route-modal"
import { useCompany } from "../../../../hooks/api/companies-admin"
import { useUpdateCompanyCompliance } from "../../../../hooks/api/investor-financials-admin"

const COMPANY_STATUSES = ["Active", "Inactive", "Pending", "Suspended"] as const

const EditDetailsForm = ({ companyId }: { companyId: string }) => {
  const { company } = useCompany(companyId)
  const { handleSuccess } = useRouteModal()
  const form = useForm({
    defaultValues: {
      registration_number: (company as any)?.registration_number ?? "",
      tax_id: (company as any)?.tax_id ?? "",
      status: (company as any)?.status ?? "Active",
      industry: company?.industry ?? "",
    },
    values: {
      registration_number: (company as any)?.registration_number ?? "",
      tax_id: (company as any)?.tax_id ?? "",
      status: (company as any)?.status ?? "Active",
      industry: company?.industry ?? "",
    },
  })
  const { mutateAsync, isPending } = useUpdateCompanyCompliance(companyId, {
    onSuccess: () => {
      toast.success("Company details updated")
      handleSuccess()
    },
    onError: (e) => toast.error(e?.message || "Failed to update"),
  })
  const onSubmit = form.handleSubmit(async (v) =>
    mutateAsync({
      registration_number: v.registration_number || null,
      tax_id: v.tax_id || null,
      status: v.status as any,
      industry: v.industry || null,
    })
  )

  return (
    <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
      <RouteDrawer.Header>
        <RouteDrawer.Title asChild>
          <Heading>Edit company details</Heading>
        </RouteDrawer.Title>
      </RouteDrawer.Header>
      <RouteDrawer.Body className="flex flex-1 flex-col gap-y-6 overflow-auto">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">Registration number</Label>
            <Input {...form.register("registration_number")} />
          </div>
          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">Tax ID</Label>
            <Input {...form.register("tax_id")} />
          </div>
          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">Status</Label>
            <Controller control={form.control} name="status" render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <Select.Trigger><Select.Value /></Select.Trigger>
                <Select.Content>
                  {COMPANY_STATUSES.map((t) => <Select.Item key={t} value={t}>{t}</Select.Item>)}
                </Select.Content>
              </Select>
            )} />
          </div>
          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">Industry</Label>
            <Input {...form.register("industry")} />
          </div>
        </div>
      </RouteDrawer.Body>
      <RouteDrawer.Footer>
        <div className="flex items-center justify-end gap-x-2">
          <RouteDrawer.Close asChild>
            <Button size="small" variant="secondary">Cancel</Button>
          </RouteDrawer.Close>
          <Button size="small" type="submit" isLoading={isPending}>Save</Button>
        </div>
      </RouteDrawer.Footer>
    </form>
  )
}

const EditDetailsPage = () => {
  const { id } = useParams()
  return (
    <RouteDrawer>
      <EditDetailsForm companyId={id!} />
    </RouteDrawer>
  )
}

export default EditDetailsPage

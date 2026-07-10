import {
  Button,
  Heading,
  Input,
  Label,
  toast,
} from "@medusajs/ui"
import { useForm } from "react-hook-form"
import { useParams } from "react-router-dom"
import { RouteFocusModal } from "../../../../components/modal/route-focus-modal"
import { useRouteModal } from "../../../../components/modal/use-route-modal"
import { useCreateCapTable } from "../../../../hooks/api/cap-tables-admin"

const CreateCapTableForm = ({ companyId }: { companyId: string }) => {
  const { handleSuccess } = useRouteModal()
  const form = useForm({
    defaultValues: { name: "", currency_code: "USD", total_shares_authorized: "" },
  })
  const { mutateAsync, isPending } = useCreateCapTable(companyId, {
    onSuccess: () => {
      toast.success("Cap table created")
      handleSuccess()
    },
    onError: (e) => toast.error(e?.message || "Failed to create cap table"),
  })
  const onSubmit = form.handleSubmit(async (v) =>
    mutateAsync({
      name: v.name,
      currency_code: v.currency_code || undefined,
      total_shares_authorized: v.total_shares_authorized
        ? Number(v.total_shares_authorized)
        : null,
      status: "active",
    })
  )

  return (
    <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
      <RouteFocusModal.Header>
        <div className="flex items-center justify-end gap-x-2">
          <RouteFocusModal.Close asChild>
            <Button size="small" variant="secondary">Cancel</Button>
          </RouteFocusModal.Close>
          <Button size="small" type="submit" isLoading={isPending}>Create</Button>
        </div>
      </RouteFocusModal.Header>
      <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-auto py-8">
        <div className="flex w-full max-w-lg flex-col gap-y-6">
          <Heading level="h2">New cap table</Heading>
          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">Name</Label>
            <Input placeholder="Ordinary cap table" {...form.register("name", { required: true })} />
          </div>
          <div className="grid grid-cols-2 gap-x-3">
            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">Currency (ISO)</Label>
              <Input placeholder="USD" {...form.register("currency_code")} />
            </div>
            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">Authorized shares</Label>
              <Input type="number" placeholder="10000000" {...form.register("total_shares_authorized")} />
            </div>
          </div>
        </div>
      </RouteFocusModal.Body>
    </form>
  )
}

const CreateCapTablePage = () => {
  const { id } = useParams()
  return (
    <RouteFocusModal>
      <CreateCapTableForm companyId={id!} />
    </RouteFocusModal>
  )
}

export default CreateCapTablePage

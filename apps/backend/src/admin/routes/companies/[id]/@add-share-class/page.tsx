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
import { RouteDrawer } from "../../../../components/modal/route-drawer/route-drawer"
import { useRouteModal } from "../../../../components/modal/use-route-modal"
import {
  useCompanyCapTables,
  useCreateShareClass,
} from "../../../../hooks/api/cap-tables-admin"

const SHARE_CLASS_TYPES = [
  "common",
  "preferred",
  "convertible_note",
  "safe",
  "warrant",
  "option",
] as const

const AddShareClassForm = ({ companyId }: { companyId: string }) => {
  const { cap_tables = [] } = useCompanyCapTables(companyId)
  const capTable = cap_tables[0]
  const { handleSuccess } = useRouteModal()
  const form = useForm({
    defaultValues: { name: "", class_type: "common", authorized_shares: "" },
  })
  const { mutateAsync, isPending } = useCreateShareClass(capTable?.id ?? "", {
    onSuccess: () => {
      toast.success("Share class added")
      handleSuccess()
    },
    onError: (e) => toast.error(e?.message || "Failed to add share class"),
  })
  const onSubmit = form.handleSubmit(async (v) => {
    if (!capTable) {
      toast.error("Create a cap table first")
      return
    }
    return mutateAsync({
      name: v.name,
      class_type: v.class_type,
      authorized_shares: v.authorized_shares ? Number(v.authorized_shares) : null,
    })
  })

  return (
    <form onSubmit={onSubmit} className="flex flex-1 flex-col">
      <RouteDrawer.Header>
        <RouteDrawer.Title asChild>
          <Heading>Add share class</Heading>
        </RouteDrawer.Title>
      </RouteDrawer.Header>
      <RouteDrawer.Body className="flex flex-1 flex-col gap-y-6 overflow-auto">
        {!capTable && (
          <Text size="small" className="text-ui-fg-error">
            This company has no cap table yet — create one first.
          </Text>
        )}
        <div className="flex flex-col gap-y-2">
          <Label size="small" weight="plus">Name</Label>
          <Input placeholder="Series A Preferred" {...form.register("name", { required: true })} />
        </div>
        <div className="flex flex-col gap-y-2">
          <Label size="small" weight="plus">Type</Label>
          <Controller
            control={form.control}
            name="class_type"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <Select.Trigger><Select.Value /></Select.Trigger>
                <Select.Content>
                  {SHARE_CLASS_TYPES.map((t) => (
                    <Select.Item key={t} value={t}>{t}</Select.Item>
                  ))}
                </Select.Content>
              </Select>
            )}
          />
        </div>
        <div className="flex flex-col gap-y-2">
          <Label size="small" weight="plus">Authorized shares</Label>
          <Input type="number" {...form.register("authorized_shares")} />
        </div>
      </RouteDrawer.Body>
      <RouteDrawer.Footer>
        <div className="flex items-center justify-end gap-x-2">
          <RouteDrawer.Close asChild>
            <Button size="small" variant="secondary">Cancel</Button>
          </RouteDrawer.Close>
          <Button size="small" type="submit" isLoading={isPending} disabled={!capTable}>
            Save
          </Button>
        </div>
      </RouteDrawer.Footer>
    </form>
  )
}

const AddShareClassPage = () => {
  const { id } = useParams()
  return (
    <RouteDrawer>
      <AddShareClassForm companyId={id!} />
    </RouteDrawer>
  )
}

export default AddShareClassPage

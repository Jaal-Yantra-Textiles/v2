import { Button, Heading, Input, Label, Text, toast } from "@medusajs/ui"
import { useForm } from "react-hook-form"
import { useParams, useSearchParams } from "react-router-dom"
import { RouteDrawer } from "../../../../components/modal/route-drawer/route-drawer"
import { useRouteModal } from "../../../../components/modal/use-route-modal"
import {
  useCompanyCapTables,
  useUpdateRoundTarget,
} from "../../../../hooks/api/cap-tables-admin"

const EditRoundTargetForm = ({
  companyId,
  roundId,
}: {
  companyId: string
  roundId: string
}) => {
  const { cap_tables = [] } = useCompanyCapTables(companyId)
  const capTable = cap_tables[0]
  const round = capTable?.funding_rounds?.find((r) => r.id === roundId)
  const { handleSuccess } = useRouteModal()

  // `values` (not `defaultValues`) so the field syncs once the round loads.
  const form = useForm({
    values: {
      target_amount:
        round?.target_amount != null ? String(round.target_amount) : "",
    },
  })

  const { mutateAsync, isPending } = useUpdateRoundTarget(capTable?.id ?? "", {
    onSuccess: () => {
      toast.success("Target amount updated")
      handleSuccess()
    },
    onError: (e) => toast.error(e?.message || "Failed to update target"),
  })

  const onSubmit = form.handleSubmit(async (v) => {
    await mutateAsync({
      roundId,
      target_amount: v.target_amount ? Number(v.target_amount) : null,
    })
  })

  return (
    <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
      <RouteDrawer.Header>
        <RouteDrawer.Title asChild>
          <Heading>Edit target amount</Heading>
        </RouteDrawer.Title>
      </RouteDrawer.Header>
      <RouteDrawer.Body className="flex flex-1 flex-col gap-y-6 overflow-auto">
        <Text size="small" className="text-ui-fg-subtle">
          {round ? `Round: ${round.name}` : "Loading round…"} — you can revise the
          target only until the first participant onboards.
        </Text>
        <div className="flex flex-col gap-y-2">
          <Label size="small" weight="plus">Target amount</Label>
          <Input
            type="number"
            placeholder="Leave blank to clear"
            {...form.register("target_amount")}
          />
        </div>
      </RouteDrawer.Body>
      <RouteDrawer.Footer>
        <div className="flex items-center justify-end gap-x-2">
          <RouteDrawer.Close asChild>
            <Button size="small" variant="secondary">Cancel</Button>
          </RouteDrawer.Close>
          <Button size="small" type="submit" isLoading={isPending} disabled={!round}>
            Save
          </Button>
        </div>
      </RouteDrawer.Footer>
    </form>
  )
}

const EditRoundTargetPage = () => {
  const { id } = useParams()
  const [params] = useSearchParams()
  const roundId = params.get("round_id") ?? ""
  return (
    <RouteDrawer>
      <EditRoundTargetForm companyId={id!} roundId={roundId} />
    </RouteDrawer>
  )
}

export default EditRoundTargetPage

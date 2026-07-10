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
  useCreateFundingRound,
} from "../../../../hooks/api/cap-tables-admin"

const ROUND_TYPES = [
  "pre_seed",
  "seed",
  "series_a",
  "series_b",
  "series_c",
  "series_d_plus",
  "bridge",
  "debt",
  "grant",
] as const

const AddRoundForm = ({ companyId }: { companyId: string }) => {
  const { cap_tables = [] } = useCompanyCapTables(companyId)
  const capTable = cap_tables[0]
  const { handleSuccess } = useRouteModal()
  const form = useForm({
    defaultValues: {
      name: "",
      round_type: "seed",
      target_amount: "",
      pre_money_valuation: "",
      price_per_share: "",
    },
  })
  const { mutateAsync, isPending } = useCreateFundingRound(capTable?.id ?? "", {
    onSuccess: () => {
      toast.success("Funding round created")
      handleSuccess()
    },
    onError: (e) => toast.error(e?.message || "Failed to create round"),
  })
  const onSubmit = form.handleSubmit(async (v) => {
    if (!capTable) {
      toast.error("Create a cap table first")
      return
    }
    return mutateAsync({
      name: v.name,
      round_type: v.round_type,
      status: "planned",
      target_amount: v.target_amount ? Number(v.target_amount) : null,
      pre_money_valuation: v.pre_money_valuation ? Number(v.pre_money_valuation) : null,
      price_per_share: v.price_per_share ? Number(v.price_per_share) : null,
    })
  })

  return (
    <form onSubmit={onSubmit} className="flex flex-1 flex-col">
      <RouteDrawer.Header>
        <RouteDrawer.Title asChild>
          <Heading>Add funding round</Heading>
        </RouteDrawer.Title>
      </RouteDrawer.Header>
      <RouteDrawer.Body className="flex flex-1 flex-col gap-y-6 overflow-auto">
        <Text size="small" className="text-ui-fg-subtle">
          An open round becomes a deal investors can participate in.
        </Text>
        <div className="flex flex-col gap-y-2">
          <Label size="small" weight="plus">Name</Label>
          <Input placeholder="Seed round 2026" {...form.register("name", { required: true })} />
        </div>
        <div className="flex flex-col gap-y-2">
          <Label size="small" weight="plus">Round type</Label>
          <Controller
            control={form.control}
            name="round_type"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <Select.Trigger><Select.Value /></Select.Trigger>
                <Select.Content>
                  {ROUND_TYPES.map((t) => (
                    <Select.Item key={t} value={t}>{t}</Select.Item>
                  ))}
                </Select.Content>
              </Select>
            )}
          />
        </div>
        <div className="grid grid-cols-2 gap-x-3">
          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">Target amount</Label>
            <Input type="number" {...form.register("target_amount")} />
          </div>
          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">Pre-money valuation</Label>
            <Input type="number" {...form.register("pre_money_valuation")} />
          </div>
          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">Price / share</Label>
            <Input type="number" {...form.register("price_per_share")} />
          </div>
        </div>
      </RouteDrawer.Body>
      <RouteDrawer.Footer>
        <div className="flex items-center justify-end gap-x-2">
          <RouteDrawer.Close asChild>
            <Button size="small" variant="secondary">Cancel</Button>
          </RouteDrawer.Close>
          <Button size="small" type="submit" isLoading={isPending} disabled={!capTable}>
            Create
          </Button>
        </div>
      </RouteDrawer.Footer>
    </form>
  )
}

const AddRoundPage = () => {
  const { id } = useParams()
  return (
    <RouteDrawer>
      <AddRoundForm companyId={id!} />
    </RouteDrawer>
  )
}

export default AddRoundPage

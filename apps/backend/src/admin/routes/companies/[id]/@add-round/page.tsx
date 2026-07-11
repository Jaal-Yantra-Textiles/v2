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

const INSTRUMENTS = [
  { value: "equity", label: "Priced equity (shares)" },
  { value: "safe", label: "SAFE (converts later)" },
  { value: "convertible_note", label: "Convertible note / loan" },
  { value: "ccps", label: "CCPS (iSAFE — preference shares)" },
] as const

const AddRoundForm = ({ companyId }: { companyId: string }) => {
  const { cap_tables = [] } = useCompanyCapTables(companyId)
  const capTable = cap_tables[0]
  const { handleSuccess } = useRouteModal()
  const form = useForm({
    defaultValues: {
      name: "",
      instrument_type: "equity" as "equity" | "safe" | "convertible_note" | "ccps",
      round_type: "seed",
      target_amount: "",
      pre_money_valuation: "",
      price_per_share: "",
      valuation_cap: "",
      discount_rate: "",
      safe_type: "post_money" as "post_money" | "pre_money",
    },
  })
  const instrument = form.watch("instrument_type")
  // SAFE, note and CCPS all use the cap/discount economics and convert later.
  const isSafe =
    instrument === "safe" ||
    instrument === "convertible_note" ||
    instrument === "ccps"
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
    const safe =
      v.instrument_type === "safe" ||
      v.instrument_type === "convertible_note" ||
      v.instrument_type === "ccps"
    return mutateAsync({
      name: v.name,
      instrument_type: v.instrument_type,
      // A SAFE/convertible/CCPS round is tagged by its instrument so it reads
      // clearly in the cap table; equity rounds keep the chosen stage.
      round_type:
        v.instrument_type === "ccps" ? "ccps" : safe ? "safe" : v.round_type,
      status: "planned",
      target_amount: v.target_amount ? Number(v.target_amount) : null,
      pre_money_valuation:
        !safe && v.pre_money_valuation ? Number(v.pre_money_valuation) : null,
      price_per_share: !safe && v.price_per_share ? Number(v.price_per_share) : null,
      valuation_cap: safe && v.valuation_cap ? Number(v.valuation_cap) : null,
      discount_rate: safe && v.discount_rate ? Number(v.discount_rate) / 100 : null,
      safe_type: safe ? v.safe_type : null,
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
          <Label size="small" weight="plus">Instrument</Label>
          <Controller
            control={form.control}
            name="instrument_type"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <Select.Trigger><Select.Value /></Select.Trigger>
                <Select.Content>
                  {INSTRUMENTS.map((t) => (
                    <Select.Item key={t.value} value={t.value}>{t.label}</Select.Item>
                  ))}
                </Select.Content>
              </Select>
            )}
          />
          <Text size="xsmall" className="text-ui-fg-muted">
            {instrument === "ccps"
              ? "Participants invest now and are allotted preference shares (CCPS) that mandatorily convert to equity at a priced round."
              : isSafe
              ? "Participants invest now and receive a SAFE/note — equity is issued when it converts at a priced round."
              : "Participants are allocated shares at the round price."}
          </Text>
        </div>

        {!isSafe && (
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
        )}

        <div className="flex flex-col gap-y-2">
          <Label size="small" weight="plus">Target amount</Label>
          <Input type="number" {...form.register("target_amount")} />
        </div>

        {isSafe ? (
          <div className="grid grid-cols-2 gap-x-3 gap-y-4">
            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">Valuation cap</Label>
              <Input type="number" placeholder="5000000" {...form.register("valuation_cap")} />
            </div>
            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">Discount (%)</Label>
              <Input type="number" placeholder="20" {...form.register("discount_rate")} />
            </div>
            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">SAFE type</Label>
              <Controller
                control={form.control}
                name="safe_type"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <Select.Trigger><Select.Value /></Select.Trigger>
                    <Select.Content>
                      <Select.Item value="post_money">Post-money</Select.Item>
                      <Select.Item value="pre_money">Pre-money</Select.Item>
                    </Select.Content>
                  </Select>
                )}
              />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-3 gap-y-4">
            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">Pre-money valuation</Label>
              <Input type="number" {...form.register("pre_money_valuation")} />
            </div>
            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">Price / share</Label>
              <Input type="number" {...form.register("price_per_share")} />
            </div>
          </div>
        )}
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

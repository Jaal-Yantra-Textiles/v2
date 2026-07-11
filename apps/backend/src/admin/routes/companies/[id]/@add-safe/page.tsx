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
  useProvisionConvertible,
} from "../../../../hooks/api/cap-tables-admin"
import { useCompanyInvestors } from "../../../../hooks/api/companies-admin"

type FormValues = {
  mode: "existing" | "new"
  investor_id: string
  new_name: string
  new_email: string
  new_type: "individual" | "entity" | "fund"
  instrument_type: "safe" | "convertible_note"
  principal_amount: string
  valuation_cap: string
  discount_rate: string
  safe_type: "post_money" | "pre_money"
  investment_date: string
  status: "outstanding" | "converted" | "redeemed" | "cancelled" | "expired"
  notes: string
}

// Record a (possibly historical) SAFE / convertible for an existing investor —
// e.g. someone who invested via SAFE before this system existed and holds no
// shares yet. Mirrors the manual share-provision form.
const AddSafeForm = ({ companyId }: { companyId: string }) => {
  const { cap_tables = [] } = useCompanyCapTables(companyId)
  const capTable = cap_tables[0]
  const { investors = [] } = useCompanyInvestors(companyId)
  const { handleSuccess } = useRouteModal()

  const form = useForm<FormValues>({
    defaultValues: {
      mode: investors.length ? "existing" : "new",
      investor_id: "",
      new_name: "",
      new_email: "",
      new_type: "individual",
      instrument_type: "safe",
      principal_amount: "",
      valuation_cap: "",
      discount_rate: "",
      safe_type: "post_money",
      investment_date: "",
      status: "outstanding",
    },
  })

  const mode = form.watch("mode")
  const ccy = capTable?.currency_code

  const { mutateAsync, isPending } = useProvisionConvertible(capTable?.id ?? "", {
    onSuccess: () => {
      toast.success("SAFE recorded")
      handleSuccess()
    },
    onError: (e) => toast.error(e?.message || "Failed to record SAFE"),
  })

  const onSubmit = form.handleSubmit(async (v) => {
    if (!capTable) {
      toast.error("Create a cap table first")
      return
    }
    const principal = Number(v.principal_amount)
    if (!principal || principal <= 0) {
      toast.error("Enter a positive principal amount")
      return
    }
    return mutateAsync({
      ...(v.mode === "existing"
        ? { investor_id: v.investor_id }
        : { investor: { name: v.new_name, email: v.new_email || undefined, investor_type: v.new_type } }),
      instrument_type: v.instrument_type,
      principal_amount: principal,
      valuation_cap: v.valuation_cap ? Number(v.valuation_cap) : null,
      discount_rate: v.discount_rate ? Number(v.discount_rate) / 100 : null,
      safe_type: v.safe_type,
      investment_date: v.investment_date
        ? new Date(v.investment_date).toISOString()
        : null,
      status: v.status,
      notes: v.notes || null,
    })
  })

  return (
    <form onSubmit={onSubmit} className="flex flex-1 flex-col">
      <RouteDrawer.Header>
        <RouteDrawer.Title asChild>
          <Heading>Record SAFE (manual)</Heading>
        </RouteDrawer.Title>
      </RouteDrawer.Header>
      <RouteDrawer.Body className="flex flex-1 flex-col gap-y-6 overflow-auto">
        {!capTable && (
          <Text size="small" className="text-ui-fg-error">
            This company has no cap table yet — create one first.
          </Text>
        )}
        <Text size="small" className="text-ui-fg-subtle">
          Record a SAFE or convertible note directly — no shares are issued. Use
          for an investor who already invested via SAFE. Value (implied ownership
          + current value) is derived against the cap table valuation.
        </Text>

        {/* Investor: existing or new */}
        <div className="flex flex-col gap-y-2">
          <Label size="small" weight="plus">Investor</Label>
          <Controller
            control={form.control}
            name="mode"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <Select.Trigger><Select.Value /></Select.Trigger>
                <Select.Content>
                  <Select.Item value="existing" disabled={!investors.length}>
                    Existing investor
                  </Select.Item>
                  <Select.Item value="new">New individual</Select.Item>
                </Select.Content>
              </Select>
            )}
          />
        </div>

        {mode === "existing" ? (
          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">Select investor</Label>
            <Controller
              control={form.control}
              name="investor_id"
              rules={{ required: mode === "existing" }}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <Select.Trigger><Select.Value placeholder="Pick an investor" /></Select.Trigger>
                  <Select.Content>
                    {investors.map((inv) => (
                      <Select.Item key={inv.id} value={inv.id}>
                        {inv.name}{inv.email ? ` · ${inv.email}` : ""}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              )}
            />
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">Name</Label>
              <Input placeholder="Jane Doe" {...form.register("new_name", { required: mode === "new" })} />
            </div>
            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">Email (optional)</Label>
              <Input type="email" placeholder="jane@example.com" {...form.register("new_email")} />
            </div>
            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">Type</Label>
              <Controller
                control={form.control}
                name="new_type"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <Select.Trigger><Select.Value /></Select.Trigger>
                    <Select.Content>
                      <Select.Item value="individual">Individual</Select.Item>
                      <Select.Item value="entity">Entity</Select.Item>
                      <Select.Item value="fund">Fund</Select.Item>
                    </Select.Content>
                  </Select>
                )}
              />
            </div>
          </>
        )}

        {/* Instrument + economics */}
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">Instrument</Label>
            <Controller
              control={form.control}
              name="instrument_type"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <Select.Trigger><Select.Value /></Select.Trigger>
                  <Select.Content>
                    <Select.Item value="safe">SAFE</Select.Item>
                    <Select.Item value="convertible_note">Convertible note</Select.Item>
                  </Select.Content>
                </Select>
              )}
            />
          </div>
          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">Principal {ccy ? `(${ccy})` : ""}</Label>
            <Input type="number" min="0" step="any" {...form.register("principal_amount", { required: true })} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">Valuation cap {ccy ? `(${ccy})` : ""}</Label>
            <Input type="number" min="0" step="any" placeholder="5000000" {...form.register("valuation_cap")} />
          </div>
          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">Discount (%)</Label>
            <Input type="number" min="0" max="100" placeholder="20" {...form.register("discount_rate")} />
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
          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">Investment date</Label>
            <Input type="date" {...form.register("investment_date")} />
          </div>
        </div>

        <div className="flex flex-col gap-y-2">
          <Label size="small" weight="plus">Status</Label>
          <Controller
            control={form.control}
            name="status"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <Select.Trigger><Select.Value /></Select.Trigger>
                <Select.Content>
                  <Select.Item value="outstanding">Outstanding</Select.Item>
                  <Select.Item value="converted">Converted</Select.Item>
                  <Select.Item value="redeemed">Redeemed</Select.Item>
                  <Select.Item value="cancelled">Cancelled</Select.Item>
                  <Select.Item value="expired">Expired</Select.Item>
                </Select.Content>
              </Select>
            )}
          />
        </div>

        <div className="flex flex-col gap-y-2">
          <Label size="small" weight="plus">Notes (optional)</Label>
          <Input placeholder="Original SAFE signed 2024…" {...form.register("notes")} />
        </div>
      </RouteDrawer.Body>
      <RouteDrawer.Footer>
        <div className="flex items-center justify-end gap-x-2">
          <RouteDrawer.Close asChild>
            <Button size="small" variant="secondary">Cancel</Button>
          </RouteDrawer.Close>
          <Button size="small" type="submit" isLoading={isPending} disabled={!capTable}>
            Record SAFE
          </Button>
        </div>
      </RouteDrawer.Footer>
    </form>
  )
}

const AddSafePage = () => {
  const { id } = useParams()
  return (
    <RouteDrawer>
      <AddSafeForm companyId={id!} />
    </RouteDrawer>
  )
}

export default AddSafePage

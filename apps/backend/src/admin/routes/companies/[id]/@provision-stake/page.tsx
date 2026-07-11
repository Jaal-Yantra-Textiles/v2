import {
  Button,
  Heading,
  Input,
  Label,
  Select,
  Switch,
  Text,
  toast,
} from "@medusajs/ui"
import { useMemo, useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { useParams } from "react-router-dom"
import { RouteDrawer } from "../../../../components/modal/route-drawer/route-drawer"
import { useRouteModal } from "../../../../components/modal/use-route-modal"
import {
  useCompanyCapTables,
  useProvisionStake,
} from "../../../../hooks/api/cap-tables-admin"
import { useCompanyInvestors } from "../../../../hooks/api/companies-admin"

const STATUSES = ["fully_paid", "active", "partially_paid", "unpaid"] as const

type FormValues = {
  mode: "existing" | "new"
  investor_id: string
  new_name: string
  new_email: string
  new_type: "individual" | "entity" | "fund"
  number_of_shares: string
  share_price: string
  total_invested: string
  status: (typeof STATUSES)[number]
  certificate_number: string
}

const ProvisionStakeForm = ({ companyId }: { companyId: string }) => {
  const { cap_tables = [] } = useCompanyCapTables(companyId)
  const capTable = cap_tables[0]
  const { investors = [] } = useCompanyInvestors(companyId)
  const { handleSuccess } = useRouteModal()
  const [autoInvested, setAutoInvested] = useState(true)

  const form = useForm<FormValues>({
    defaultValues: {
      mode: investors.length ? "existing" : "new",
      investor_id: "",
      new_name: "",
      new_email: "",
      new_type: "individual",
      number_of_shares: "",
      share_price: "",
      total_invested: "",
      status: "fully_paid",
      certificate_number: "",
    },
  })

  const mode = form.watch("mode")
  const shares = form.watch("number_of_shares")
  const price = form.watch("share_price")

  // Auto-derive total invested = shares × price (editable — toggle off to override).
  const derivedInvested = useMemo(() => {
    const s = Number(shares)
    const p = Number(price)
    return s > 0 && p > 0 ? String(s * p) : ""
  }, [shares, price])

  const { mutateAsync, isPending } = useProvisionStake(capTable?.id ?? "", companyId, {
    onSuccess: () => {
      toast.success("Shares provisioned")
      handleSuccess()
    },
    onError: (e) => toast.error(e?.message || "Failed to provision shares"),
  })

  const onSubmit = form.handleSubmit(async (v) => {
    if (!capTable) {
      toast.error("Create a cap table first")
      return
    }
    const numShares = Number(v.number_of_shares)
    if (!numShares || numShares <= 0) {
      toast.error("Enter a positive number of shares")
      return
    }
    const totalInvested = autoInvested
      ? derivedInvested
        ? Number(derivedInvested)
        : undefined
      : v.total_invested
        ? Number(v.total_invested)
        : undefined

    return mutateAsync({
      ...(v.mode === "existing"
        ? { investor_id: v.investor_id }
        : { investor: { name: v.new_name, email: v.new_email || undefined, investor_type: v.new_type } }),
      number_of_shares: numShares,
      share_price: v.share_price ? Number(v.share_price) : undefined,
      total_invested: totalInvested,
      status: v.status,
      certificate_number: v.certificate_number || undefined,
    })
  })

  const ccy = capTable?.currency_code

  return (
    <form onSubmit={onSubmit} className="flex flex-1 flex-col">
      <RouteDrawer.Header>
        <RouteDrawer.Title asChild>
          <Heading>Provision shares (manual)</Heading>
        </RouteDrawer.Title>
      </RouteDrawer.Header>
      <RouteDrawer.Body className="flex flex-1 flex-col gap-y-6 overflow-auto">
        {!capTable && (
          <Text size="small" className="text-ui-fg-error">
            This company has no cap table yet — create one first.
          </Text>
        )}
        <Text size="small" className="text-ui-fg-subtle">
          Record a shareholding directly on the cap table — no deal or payment
          required. Use for people/individuals who already hold shares.
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

        {/* Allocation */}
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">Number of shares</Label>
            <Input type="number" min="1" {...form.register("number_of_shares", { required: true })} />
          </div>
          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">Share price {ccy ? `(${ccy})` : ""}</Label>
            <Input type="number" min="0" step="any" {...form.register("share_price")} />
          </div>
        </div>

        <div className="flex flex-col gap-y-2">
          <div className="flex items-center justify-between">
            <Label size="small" weight="plus">Total invested {ccy ? `(${ccy})` : ""}</Label>
            <div className="flex items-center gap-x-2">
              <Text size="xsmall" className="text-ui-fg-subtle">Auto (shares × price)</Text>
              <Switch checked={autoInvested} onCheckedChange={setAutoInvested} />
            </div>
          </div>
          <Input
            type="number"
            min="0"
            step="any"
            disabled={autoInvested}
            value={autoInvested ? derivedInvested : undefined}
            {...(autoInvested ? {} : form.register("total_invested"))}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">Status</Label>
            <Controller
              control={form.control}
              name="status"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <Select.Trigger><Select.Value /></Select.Trigger>
                  <Select.Content>
                    {STATUSES.map((s) => (
                      <Select.Item key={s} value={s}>{s}</Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              )}
            />
          </div>
          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">Certificate # (optional)</Label>
            <Input {...form.register("certificate_number")} />
          </div>
        </div>
      </RouteDrawer.Body>
      <RouteDrawer.Footer>
        <div className="flex items-center justify-end gap-x-2">
          <RouteDrawer.Close asChild>
            <Button size="small" variant="secondary">Cancel</Button>
          </RouteDrawer.Close>
          <Button size="small" type="submit" isLoading={isPending} disabled={!capTable}>
            Provision
          </Button>
        </div>
      </RouteDrawer.Footer>
    </form>
  )
}

const ProvisionStakePage = () => {
  const { id } = useParams()
  return (
    <RouteDrawer>
      <ProvisionStakeForm companyId={id!} />
    </RouteDrawer>
  )
}

export default ProvisionStakePage

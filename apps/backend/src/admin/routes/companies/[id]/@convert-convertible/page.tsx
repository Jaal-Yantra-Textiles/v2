import {
  Badge,
  Button,
  Heading,
  Input,
  Label,
  Select,
  Text,
  toast,
} from "@medusajs/ui"
import { useMemo } from "react"
import { Controller, useForm } from "react-hook-form"
import { useParams, useSearchParams } from "react-router-dom"
import { RouteDrawer } from "../../../../components/modal/route-drawer/route-drawer"
import { useRouteModal } from "../../../../components/modal/use-route-modal"
import {
  useCompanyCapTables,
  useCapTableConvertibles,
  useConvertConvertible,
  type AdminConvertible,
} from "../../../../hooks/api/cap-tables-admin"

const money = (v?: number | null, ccy?: string | null) =>
  v == null ? "—" : `${ccy ? ccy + " " : ""}${new Intl.NumberFormat().format(Number(v))}`

const INSTRUMENT_LABEL: Record<string, string> = {
  safe: "SAFE",
  convertible_note: "Loan / note",
  ccps: "CCPS",
}

// Roughly how long ago the money went in — grounds the "a loan from 2 years ago"
// story. Kept approximate on purpose (no exact-day precision needed).
const agoLabel = (iso?: string | null): string | null => {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return null
  const years = (Date.now() - then) / (365.25 * 24 * 3600 * 1000)
  if (years < 0.08) return "recently"
  if (years < 1) return `${Math.round(years * 12)} months ago`
  return `${years.toFixed(years < 2 ? 1 : 0)} years ago`
}

type FormValues = {
  target: "equity" | "ccps"
  round_price_per_share: string
  fully_diluted_shares: string
  share_class_id: string
  liquidation_preference_multiple: string
  conversion_ratio: string
}

// Mirror of the server-side computeConversion, just for the live preview.
const previewShares = (
  c: AdminConvertible | undefined,
  roundPrice: number,
  fds: number
): { price: number | null; shares: number | null; basis: string } => {
  if (!c) return { price: null, shares: null, basis: "unknown" }
  const principal = Number(c.principal_amount ?? 0)
  const cap = Number(c.valuation_cap ?? 0)
  const discount = Number(c.discount_rate ?? 0)
  const capPrice = cap > 0 && fds > 0 ? cap / fds : null
  const discountPrice =
    roundPrice > 0 && discount > 0 && discount < 1 ? roundPrice * (1 - discount) : null
  const candidates = [capPrice, discountPrice, roundPrice > 0 ? roundPrice : null].filter(
    (v): v is number => v != null && v > 0
  )
  if (candidates.length) {
    const price = Math.min(...candidates)
    const basis =
      price === capPrice ? "cap" : price === discountPrice ? "discount" : "round price"
    return { price, shares: principal > 0 ? Math.round(principal / price) : null, basis }
  }
  if (c.num_shares && Number(c.num_shares) > 0) {
    const ratio = Number(c.conversion_ratio ?? 1)
    return {
      price: null,
      shares: Math.round(Number(c.num_shares) * ratio),
      basis: "ratio",
    }
  }
  return { price: null, shares: null, basis: "unknown" }
}

const ConvertForm = ({ companyId }: { companyId: string }) => {
  const [params] = useSearchParams()
  const convertibleId = params.get("convertible_id") || ""
  const { cap_tables = [] } = useCompanyCapTables(companyId)
  const capTable = cap_tables[0]
  const { convertibles = [] } = useCapTableConvertibles(capTable?.id ?? "")
  const convertible = convertibles.find((c) => c.id === convertibleId)
  const { handleSuccess } = useRouteModal()
  const ccy = capTable?.currency_code

  const form = useForm<FormValues>({
    defaultValues: {
      target: "ccps",
      round_price_per_share: "",
      fully_diluted_shares: capTable?.fully_diluted_shares
        ? String(capTable.fully_diluted_shares)
        : "",
      share_class_id: "",
      liquidation_preference_multiple: "1",
      conversion_ratio: "1",
    },
  })

  const target = form.watch("target")
  const roundPrice = Number(form.watch("round_price_per_share") || 0)
  const fds = Number(form.watch("fully_diluted_shares") || 0)
  const preview = useMemo(
    () => previewShares(convertible, roundPrice, fds),
    [convertible, roundPrice, fds]
  )

  const { mutateAsync, isPending } = useConvertConvertible(capTable?.id ?? "", {
    onSuccess: (r) =>
      toast.success(
        r.target === "ccps" ? "Converted to CCPS shares" : "Converted to equity"
      ),
    onError: (e) => toast.error(e?.message || "Conversion failed"),
  })

  const shareClasses = capTable?.share_classes ?? []

  const onSubmit = form.handleSubmit(async (v) => {
    if (!convertible) {
      toast.error("Instrument not found")
      return
    }
    await mutateAsync({
      convertibleId: convertible.id,
      payload: {
        target: v.target,
        round_price_per_share: v.round_price_per_share
          ? Number(v.round_price_per_share)
          : null,
        fully_diluted_shares: v.fully_diluted_shares
          ? Number(v.fully_diluted_shares)
          : null,
        share_class_id: v.target === "equity" && v.share_class_id ? v.share_class_id : null,
        liquidation_preference_multiple:
          v.target === "ccps" && v.liquidation_preference_multiple
            ? Number(v.liquidation_preference_multiple)
            : null,
        conversion_ratio:
          v.target === "ccps" && v.conversion_ratio ? Number(v.conversion_ratio) : null,
      },
    })
    handleSuccess()
  })

  return (
    <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
      <RouteDrawer.Header>
        <RouteDrawer.Title asChild>
          <Heading>Convert instrument</Heading>
        </RouteDrawer.Title>
      </RouteDrawer.Header>
      <RouteDrawer.Body className="flex flex-1 flex-col gap-y-6 overflow-auto">
        {!convertible ? (
          <Text size="small" className="text-ui-fg-error">
            Instrument not found on this cap table.
          </Text>
        ) : (
          <>
            {/* The instrument being converted — the "loan from 2 years ago" story. */}
            <div className="rounded-lg border p-3">
              <div className="mb-2 flex items-center gap-x-2">
                <Badge size="2xsmall" color="purple">
                  {INSTRUMENT_LABEL[convertible.instrument_type ?? "safe"] ?? "SAFE"}
                </Badge>
                <Text weight="plus">
                  {convertible.investor?.name ?? convertible.investor_id ?? "Investor"}
                </Text>
              </div>
              <Text size="small" className="text-ui-fg-subtle">
                {money(convertible.principal_amount, ccy)} invested
                {agoLabel(convertible.investment_date)
                  ? ` · ${agoLabel(convertible.investment_date)}`
                  : ""}
                {convertible.valuation_cap
                  ? ` · cap ${money(convertible.valuation_cap, ccy)}`
                  : ""}
                {convertible.discount_rate
                  ? ` · ${(Number(convertible.discount_rate) * 100).toFixed(0)}% discount`
                  : ""}
              </Text>
              {convertible.instrument_type === "convertible_note" && (
                <Text size="xsmall" className="mt-1 text-ui-fg-muted">
                  This loan will be turned into CCPS preference shares.
                </Text>
              )}
            </div>

            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus">Convert into</Label>
              <Controller
                control={form.control}
                name="target"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <Select.Trigger><Select.Value /></Select.Trigger>
                    <Select.Content>
                      <Select.Item value="ccps">CCPS (preference shares)</Select.Item>
                      <Select.Item value="equity">Equity (common/preferred stake)</Select.Item>
                    </Select.Content>
                  </Select>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-y-2">
                <Label size="small" weight="plus">Round price / share {ccy ? `(${ccy})` : ""}</Label>
                <Input type="number" min="0" step="any" placeholder="10" {...form.register("round_price_per_share")} />
              </div>
              <div className="flex flex-col gap-y-2">
                <Label size="small" weight="plus">Fully-diluted shares</Label>
                <Input type="number" min="0" step="1" placeholder="1000000" {...form.register("fully_diluted_shares")} />
              </div>
            </div>

            {target === "equity" && shareClasses.length > 0 && (
              <div className="flex flex-col gap-y-2">
                <Label size="small" weight="plus">Target share class (optional)</Label>
                <Controller
                  control={form.control}
                  name="share_class_id"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <Select.Trigger><Select.Value placeholder="Unassigned" /></Select.Trigger>
                      <Select.Content>
                        {shareClasses.map((sc) => (
                          <Select.Item key={sc.id} value={sc.id}>
                            {sc.name} ({sc.class_type ?? "common"})
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select>
                  )}
                />
              </div>
            )}

            {target === "ccps" && (
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-y-2">
                  <Label size="small" weight="plus">Liq. preference (x)</Label>
                  <Input type="number" min="0" step="any" {...form.register("liquidation_preference_multiple")} />
                </div>
                <div className="flex flex-col gap-y-2">
                  <Label size="small" weight="plus">Conversion ratio</Label>
                  <Input type="number" min="0" step="any" {...form.register("conversion_ratio")} />
                </div>
              </div>
            )}

            {/* Live preview of the conversion outcome. */}
            <div className="rounded-lg border border-ui-border-strong bg-ui-bg-subtle p-3">
              <Text size="small" weight="plus">Preview</Text>
              {preview.shares != null ? (
                <Text size="small" className="mt-1 text-ui-fg-subtle">
                  ≈ <span className="text-ui-fg-base">{new Intl.NumberFormat().format(preview.shares)}</span>{" "}
                  {target === "ccps" ? "CCPS" : "equity"} shares
                  {preview.price != null ? ` @ ${money(preview.price, ccy)}/share` : ""}
                  {" "}<span className="text-ui-fg-muted">({preview.basis})</span>
                </Text>
              ) : (
                <Text size="small" className="mt-1 text-ui-fg-muted">
                  Enter a round price per share (and fully-diluted shares) to preview.
                </Text>
              )}
            </div>
          </>
        )}
      </RouteDrawer.Body>
      <RouteDrawer.Footer>
        <div className="flex items-center justify-end gap-x-2">
          <RouteDrawer.Close asChild>
            <Button size="small" variant="secondary">Cancel</Button>
          </RouteDrawer.Close>
          <Button
            size="small"
            type="submit"
            isLoading={isPending}
            disabled={!convertible || preview.shares == null}
          >
            Convert
          </Button>
        </div>
      </RouteDrawer.Footer>
    </form>
  )
}

const ConvertConvertiblePage = () => {
  const { id } = useParams()
  return (
    <RouteDrawer>
      <ConvertForm companyId={id!} />
    </RouteDrawer>
  )
}

export default ConvertConvertiblePage

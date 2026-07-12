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
import { useRecordPayment } from "../../../../hooks/api/investor-financials-admin"

const PAYMENT_TYPES = ["subscription", "capital_call", "top_up", "transfer_fee", "other"] as const
const PAYMENT_STATUSES = ["pending", "in_progress", "completed", "failed", "refunded", "cancelled"] as const
const PAYMENT_METHODS = ["bank_transfer", "card", "upi", "wallet", "cheque", "other"] as const

const RecordPaymentForm = ({ companyId }: { companyId: string }) => {
  const { handleSuccess } = useRouteModal()
  const form = useForm({
    defaultValues: {
      amount: "",
      currency_code: "USD",
      payment_type: "subscription",
      status: "pending",
      method: "bank_transfer",
      reference_number: "",
      notes: "",
    },
  })
  const { mutateAsync, isPending } = useRecordPayment(companyId, {
    onSuccess: () => {
      toast.success("Payment recorded")
      handleSuccess()
    },
    onError: (e) => toast.error(e?.message || "Failed to record payment"),
  })
  const onSubmit = form.handleSubmit(async (v) =>
    mutateAsync({
      amount: Number(v.amount),
      currency_code: v.currency_code || undefined,
      payment_type: v.payment_type,
      status: v.status,
      method: v.method,
      reference_number: v.reference_number || null,
      notes: v.notes || null,
    })
  )

  return (
    <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
      <RouteDrawer.Header>
        <RouteDrawer.Title asChild>
          <Heading>Record a payment</Heading>
        </RouteDrawer.Title>
      </RouteDrawer.Header>
      <RouteDrawer.Body className="flex flex-1 flex-col gap-y-6 overflow-auto">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">Amount</Label>
            <Input type="number" {...form.register("amount", { required: true })} />
          </div>
          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">Currency (ISO)</Label>
            <Input {...form.register("currency_code")} />
          </div>
          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">Type</Label>
            <Controller control={form.control} name="payment_type" render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <Select.Trigger><Select.Value /></Select.Trigger>
                <Select.Content>
                  {PAYMENT_TYPES.map((t) => <Select.Item key={t} value={t}>{t}</Select.Item>)}
                </Select.Content>
              </Select>
            )} />
          </div>
          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">Status</Label>
            <Controller control={form.control} name="status" render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <Select.Trigger><Select.Value /></Select.Trigger>
                <Select.Content>
                  {PAYMENT_STATUSES.map((t) => <Select.Item key={t} value={t}>{t}</Select.Item>)}
                </Select.Content>
              </Select>
            )} />
          </div>
          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">Method</Label>
            <Controller control={form.control} name="method" render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <Select.Trigger><Select.Value /></Select.Trigger>
                <Select.Content>
                  {PAYMENT_METHODS.map((t) => <Select.Item key={t} value={t}>{t}</Select.Item>)}
                </Select.Content>
              </Select>
            )} />
          </div>
          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">Reference</Label>
            <Input {...form.register("reference_number")} />
          </div>
        </div>
        <div className="flex flex-col gap-y-2">
          <Label size="small" weight="plus">Notes</Label>
          <Input {...form.register("notes")} />
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

const RecordPaymentPage = () => {
  const { id } = useParams()
  return (
    <RouteDrawer>
      <RecordPaymentForm companyId={id!} />
    </RouteDrawer>
  )
}

export default RecordPaymentPage

import { Button, DatePicker, Heading, Input, Label, Select, Text, Textarea, toast } from "@medusajs/ui"
import { useState } from "react"
import { useParams } from "react-router-dom"

import { RouteDrawer, useRouteModal } from "../../../components/modals"
import { usePartnerInventoryOrder, useSubmitPartnerInventoryOrderPayment } from "../../../hooks/api/partner-inventory-orders"
import { usePartnerPaymentMethods } from "../../../hooks/api/partner-payment-methods"
import { useMe } from "../../../hooks/api/users"

export const InventoryOrderSubmitPayment = () => {
  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <RouteDrawer.Title asChild>
          <Heading>Submit Payment</Heading>
        </RouteDrawer.Title>
        <RouteDrawer.Description className="sr-only">
          Submit a payment for this inventory order
        </RouteDrawer.Description>
      </RouteDrawer.Header>
      <InventoryOrderSubmitPaymentContent />
    </RouteDrawer>
  )
}

const InventoryOrderSubmitPaymentContent = () => {
  const { id } = useParams()
  const { handleSuccess } = useRouteModal()
  const { user } = useMe()
  const partnerId = user?.partner_id

  const { inventoryOrder } = usePartnerInventoryOrder(id || "")
  const { paymentMethods } = usePartnerPaymentMethods(partnerId)
  const { mutateAsync, isPending } = useSubmitPartnerInventoryOrderPayment(id || "")

  const [amount, setAmount] = useState<string>("")
  const [paymentDate, setPaymentDate] = useState<Date | null>(() => new Date())
  const [paidToId, setPaidToId] = useState<string>("__none__")
  const [note, setNote] = useState<string>("")

  // Pre-fill amount from total_price when inventory order loads
  const defaultAmount = inventoryOrder?.total_price != null ? String(inventoryOrder.total_price) : ""
  const displayAmount = amount || defaultAmount

  const handleSubmit = async () => {
    if (!id) return

    const numericAmount = Number(displayAmount)
    if (numericAmount <= 0) return

    const selected = (paymentMethods || []).find((m) => m.id === paidToId)
    const derivedPaymentType = selected
      ? (selected.type === "bank_account"
          ? "Bank"
          : selected.type === "cash_account"
          ? "Cash"
          : "Digital_Wallet")
      : "Cash"

    await mutateAsync(
      {
        amount: numericAmount,
        payment_type: derivedPaymentType as any,
        payment_date: paymentDate?.toISOString(),
        note: note || undefined,
        paid_to_id: paidToId === "__none__" ? undefined : paidToId,
      },
      {
        onSuccess: () => {
          toast.success("Payment submitted")
          handleSuccess()
        },
        onError: (e) => {
          toast.error(e.message)
        },
      }
    )
  }

  return (
    <>
      <RouteDrawer.Body className="flex flex-col gap-y-4">
        <div className="grid gap-y-2">
          <Label htmlFor="amount">Amount</Label>
          <Input
            id="amount"
            type="number"
            placeholder="0.00"
            value={displayAmount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        <div className="grid gap-y-2">
          <Label htmlFor="payment_date">Payment Date</Label>
          <DatePicker
            value={paymentDate}
            onChange={(date) => setPaymentDate(date)}
          />
        </div>

        <div className="grid gap-y-2">
          <Label>Payment Method (optional)</Label>
          <Select value={paidToId} onValueChange={setPaidToId}>
            <Select.Trigger>
              <Select.Value placeholder="Select a method" />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="__none__">None</Select.Item>
              {(paymentMethods || []).map((m) => (
                <Select.Item key={m.id} value={m.id}>
                  {m.type} {m.account_name ? `- ${m.account_name}` : ""}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>

        <div className="grid gap-y-2">
          <Label htmlFor="note">Note</Label>
          <Textarea
            id="note"
            placeholder="Optional note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </RouteDrawer.Body>
      <RouteDrawer.Footer>
        <div className="flex items-center gap-x-2">
          <RouteDrawer.Close asChild>
            <Button size="small" variant="secondary">
              Cancel
            </Button>
          </RouteDrawer.Close>
          <Button
            size="small"
            isLoading={isPending}
            onClick={handleSubmit}
            disabled={!id || Number(displayAmount) <= 0 || !paymentDate}
          >
            Submit Payment
          </Button>
        </div>
      </RouteDrawer.Footer>
    </>
  )
}

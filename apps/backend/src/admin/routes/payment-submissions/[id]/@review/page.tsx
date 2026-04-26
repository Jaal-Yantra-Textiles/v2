import { useEffect, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { Button, Input, Label, Select, Text, Textarea, toast } from "@medusajs/ui"
import { RouteDrawer } from "../../../../components/modal/route-drawer/route-drawer"
import {
  usePaymentSubmission,
  useReviewPaymentSubmission,
  usePartnerPaymentMethods,
} from "../../../../hooks/api/payment-submissions"

const formatMethodLabel = (m: any): string => {
  if (m.type === "bank_account") {
    return `${m.account_name}${m.bank_name ? ` — ${m.bank_name}` : ""}${m.account_number ? ` (${m.account_number.slice(-4)})` : ""}`
  }
  if (m.type === "digital_wallet") {
    return `${m.account_name}${m.wallet_id ? ` — ${m.wallet_id}` : ""}`
  }
  return m.account_name || m.id
}

const ReviewPaymentSubmissionPage = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const actionParam = searchParams.get("action") as "approve" | "reject" | null
  const initialAction = actionParam === "reject" ? "reject" : "approve"

  const [action, setAction] = useState<"approve" | "reject">(initialAction)
  const [paymentType, setPaymentType] = useState<"Bank" | "Cash" | "Digital_Wallet">("Bank")
  const [amountOverride, setAmountOverride] = useState("")
  const [paidToId, setPaidToId] = useState("")
  const [rejectionReason, setRejectionReason] = useState("")
  const [notes, setNotes] = useState("")

  // Fetch submission to get partner_id
  const { payment_submission: submission } = usePaymentSubmission(id!) as any
  const partnerId = submission?.partner_id || ""

  // Fetch partner's payment methods
  const { paymentMethods, isPending: methodsLoading } =
    usePartnerPaymentMethods(partnerId)

  // Auto-select first payment method if available
  useEffect(() => {
    if (!paidToId && paymentMethods.length > 0) {
      setPaidToId(paymentMethods[0].id)
    }
  }, [paymentMethods, paidToId])

  const { mutateAsync: review, isPending } = useReviewPaymentSubmission()

  const handleSubmit = async () => {
    try {
      const payload: any = {
        id: id!,
        action,
      }

      if (action === "approve") {
        payload.payment_type = paymentType
        if (amountOverride) payload.amount_override = Number(amountOverride)
        if (paidToId) payload.paid_to_id = paidToId
      } else {
        if (rejectionReason) payload.rejection_reason = rejectionReason
      }

      if (notes) payload.notes = notes

      await review(payload)

      toast.success(
        action === "approve"
          ? "Submission approved and payment created"
          : "Submission rejected"
      )
      navigate("..", { replace: true })
    } catch (e: any) {
      toast.error(e?.message || `Failed to ${action} submission`)
    }
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <RouteDrawer.Title>
          {action === "approve" ? "Approve" : "Reject"} Submission
        </RouteDrawer.Title>
        <RouteDrawer.Description>
          {action === "approve"
            ? "Approve this payment submission and create an internal payment."
            : "Reject this submission with a reason."}
        </RouteDrawer.Description>
      </RouteDrawer.Header>

      <RouteDrawer.Body className="flex flex-col gap-y-4 pb-24">
        {/* Action Toggle */}
        <div className="flex flex-col gap-y-2">
          <Label>Action</Label>
          <Select value={action} onValueChange={(v) => setAction(v as any)}>
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="approve">Approve</Select.Item>
              <Select.Item value="reject">Reject</Select.Item>
            </Select.Content>
          </Select>
        </div>

        {action === "approve" && (
          <>
            {/* Payment Method */}
            <div className="flex flex-col gap-y-2">
              <Label>Pay To</Label>
              {methodsLoading ? (
                <Text size="small" className="text-ui-fg-muted">
                  Loading payment methods...
                </Text>
              ) : paymentMethods.length === 0 ? (
                <div className="rounded-md border border-ui-border-error bg-ui-bg-subtle p-3">
                  <Text size="small" className="text-ui-fg-error">
                    Partner has no payment methods configured. Ask them to add
                    bank/wallet details in their settings first.
                  </Text>
                </div>
              ) : (
                <Select
                  value={paidToId}
                  onValueChange={(v) => setPaidToId(v)}
                >
                  <Select.Trigger>
                    <Select.Value placeholder="Select payment method" />
                  </Select.Trigger>
                  <Select.Content>
                    {paymentMethods.map((m) => (
                      <Select.Item key={m.id} value={m.id}>
                        {formatMethodLabel(m)}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              )}
            </div>

            {/* Payment Type */}
            <div className="flex flex-col gap-y-2">
              <Label>Payment Type</Label>
              <Select
                value={paymentType}
                onValueChange={(v) => setPaymentType(v as any)}
              >
                <Select.Trigger>
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="Bank">Bank Transfer</Select.Item>
                  <Select.Item value="Cash">Cash</Select.Item>
                  <Select.Item value="Digital_Wallet">
                    Digital Wallet
                  </Select.Item>
                </Select.Content>
              </Select>
            </div>

            {/* Amount Override */}
            <div className="flex flex-col gap-y-2">
              <Label>
                Amount Override{" "}
                <span className="text-ui-fg-subtle text-xs">(optional)</span>
              </Label>
              <Input
                type="number"
                placeholder={
                  submission
                    ? `Submission total: ${Number(submission.total_amount).toLocaleString()}`
                    : "Leave empty to use submission total"
                }
                value={amountOverride}
                onChange={(e) => setAmountOverride(e.target.value)}
              />
            </div>
          </>
        )}

        {action === "reject" && (
          <div className="flex flex-col gap-y-2">
            <Label>Rejection Reason</Label>
            <Textarea
              placeholder="Why is this submission being rejected?"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
            />
          </div>
        )}

        <div className="flex flex-col gap-y-2">
          <Label>
            Notes{" "}
            <span className="text-ui-fg-subtle text-xs">(optional)</span>
          </Label>
          <Textarea
            placeholder="Additional notes..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </RouteDrawer.Body>

      <RouteDrawer.Footer className="sticky bottom-0 flex items-center justify-end gap-x-2 border-t bg-ui-bg-base p-4">
        <RouteDrawer.Close asChild>
          <Button variant="secondary">Cancel</Button>
        </RouteDrawer.Close>
        <Button
          onClick={handleSubmit}
          isLoading={isPending}
          disabled={action === "approve" && !paidToId && paymentMethods.length > 0}
          variant={action === "reject" ? "danger" : "primary"}
        >
          {action === "approve" ? "Approve & Create Payment" : "Reject"}
        </Button>
      </RouteDrawer.Footer>
    </RouteDrawer>
  )
}

export default ReviewPaymentSubmissionPage

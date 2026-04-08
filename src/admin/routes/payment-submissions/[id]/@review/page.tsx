import { useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { Button, Input, Label, Select, Textarea, toast } from "@medusajs/ui"
import { RouteDrawer } from "../../../../components/modal/route-drawer/route-drawer"
import { useReviewPaymentSubmission } from "../../../../hooks/api/payment-submissions"

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
                  <Select.Item value="Bank">Bank</Select.Item>
                  <Select.Item value="Cash">Cash</Select.Item>
                  <Select.Item value="Digital_Wallet">
                    Digital Wallet
                  </Select.Item>
                </Select.Content>
              </Select>
            </div>

            <div className="flex flex-col gap-y-2">
              <Label>
                Amount Override{" "}
                <span className="text-ui-fg-subtle text-xs">(optional)</span>
              </Label>
              <Input
                type="number"
                placeholder="Leave empty to use submission total"
                value={amountOverride}
                onChange={(e) => setAmountOverride(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-y-2">
              <Label>
                Paid To ID{" "}
                <span className="text-ui-fg-subtle text-xs">(optional)</span>
              </Label>
              <Input
                placeholder="Payment detail ID"
                value={paidToId}
                onChange={(e) => setPaidToId(e.target.value)}
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
          variant={action === "reject" ? "danger" : "primary"}
        >
          {action === "approve" ? "Approve & Create Payment" : "Reject"}
        </Button>
      </RouteDrawer.Footer>
    </RouteDrawer>
  )
}

export default ReviewPaymentSubmissionPage

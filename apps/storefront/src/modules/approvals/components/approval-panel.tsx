"use client"

import { Button, Text, Textarea } from "@medusajs/ui"
import { useState, useTransition } from "react"

import { decideOrderApproval } from "@lib/data/approvals"
import type { OrderApprovalView } from "@lib/data/approvals"

/**
 * Approve or reject, once (#2463). After an answer the page shows what was
 * decided — and, on an approval that raised the balance, the pay link.
 */
const ApprovalPanel = ({
  token,
  initial,
}: {
  token: string
  initial: OrderApprovalView
}) => {
  const [approval, setApproval] = useState(initial)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const submit = (decision: "approved" | "rejected") =>
    startTransition(async () => {
      setError(null)
      const res = await decideOrderApproval(token, decision, reason)
      if (res.error || !res.approval) {
        setError(res.error ?? "Something went wrong. Please try again.")
        return
      }
      setApproval(res.approval)
    })

  if (approval.status === "approved") {
    return (
      <div className="rounded-lg border border-ui-border-base p-6" data-testid="approval-approved">
        <Text className="txt-large-plus">Thank you, you've approved your order.</Text>
        {approval.balance_pay_url ? (
          <>
            <Text className="txt-medium text-ui-fg-subtle mt-2">
              The balance is now due. We'll send your order as soon as it's paid.
            </Text>
            <a href={approval.balance_pay_url} className="inline-block mt-4">
              <Button size="large" data-testid="approval-pay-balance">
                Pay the balance
              </Button>
            </a>
          </>
        ) : (
          <Text className="txt-medium text-ui-fg-subtle mt-2">
            We'll be in touch about delivery.
          </Text>
        )}
      </div>
    )
  }

  if (approval.status === "rejected") {
    return (
      <div className="rounded-lg border border-ui-border-base p-6" data-testid="approval-rejected">
        <Text className="txt-large-plus">Thank you, we've got your feedback.</Text>
        {approval.decision_reason && (
          <Text className="txt-medium text-ui-fg-subtle mt-2">"{approval.decision_reason}"</Text>
        )}
        <Text className="txt-medium text-ui-fg-subtle mt-2">
          We'll look at it and get back to you.
        </Text>
      </div>
    )
  }

  if (!approval.answerable) {
    return (
      <div className="rounded-lg border border-ui-border-base p-6" data-testid="approval-unavailable">
        <Text className="txt-medium">
          {approval.unavailable_reason ?? "This link can no longer be used."}
        </Text>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-ui-border-base p-6" data-testid="approval-panel">
      <Text className="txt-large-plus">Is everything right?</Text>
      {!rejecting ? (
        <div className="flex flex-col small:flex-row gap-3 mt-4">
          <Button
            size="large"
            isLoading={pending}
            onClick={() => submit("approved")}
            data-testid="approval-approve"
          >
            Approve
          </Button>
          <Button
            size="large"
            variant="secondary"
            disabled={pending}
            onClick={() => setRejecting(true)}
            data-testid="approval-start-reject"
          >
            Something isn't right
          </Button>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <Text className="txt-medium text-ui-fg-subtle">
            Tell us what isn't right, so we can fix it.
          </Text>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            data-testid="approval-reason"
          />
          <div className="flex gap-3">
            <Button
              size="large"
              variant="danger"
              isLoading={pending}
              disabled={!reason.trim()}
              onClick={() => submit("rejected")}
              data-testid="approval-reject"
            >
              Send feedback
            </Button>
            <Button
              size="large"
              variant="transparent"
              disabled={pending}
              onClick={() => setRejecting(false)}
            >
              Back
            </Button>
          </div>
        </div>
      )}
      {error && (
        <Text className="txt-small text-ui-fg-error mt-3" data-testid="approval-error">
          {error}
        </Text>
      )}
    </div>
  )
}

export default ApprovalPanel

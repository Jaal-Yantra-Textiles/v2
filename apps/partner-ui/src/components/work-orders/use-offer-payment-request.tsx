import { toast, usePrompt } from "@medusajs/ui"
import { useCallback } from "react"
import { useNavigate } from "react-router-dom"

import { sdk } from "../../lib/client"
import { draftClaimingRuns } from "../../lib/collated-actions"

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * #2357 — the money step follows the work step. After a completion, offer to
 * request payment: a run completed with an agreed price gets a Draft from
 * `subscribers/auto-draft-payment-submission.ts` moments later, so open THAT
 * (submitting it is one click) rather than a blank form that would bill the
 * run twice. No draft after a few seconds → the create form with the runs ticked.
 */
export const useOfferPaymentRequest = () => {
  const prompt = usePrompt()
  const navigate = useNavigate()

  return useCallback(
    async (runIds: string[]) => {
      if (!runIds.length) return
      const confirmed = await prompt({
        title: runIds.length > 1 ? `${runIds.length} designs completed` : "Run completed",
        description:
          "Ask to be paid for this work now? If it has an agreed price, a payment request is already prepared — you just check it and submit.",
        confirmText: "Request payment",
        cancelText: "Later",
        variant: "confirmation",
      })
      if (!confirmed) return

      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const res = await sdk.client.fetch<{ payment_submissions: any[] }>(
            "/partners/payment-submissions?limit=50",
            { method: "GET" }
          )
          const draft = draftClaimingRuns(res?.payment_submissions ?? [], runIds)
          if (draft) {
            navigate(`/payment-submissions/${draft.id}`)
            return
          }
        } catch {
          break // fall through to the create form
        }
        if (attempt === 0) toast.info("Looking for the prepared payment request…")
        await wait(2000)
      }
      navigate(`/payment-submissions/create?run_ids=${encodeURIComponent(runIds.join(","))}`)
    },
    [prompt, navigate]
  )
}

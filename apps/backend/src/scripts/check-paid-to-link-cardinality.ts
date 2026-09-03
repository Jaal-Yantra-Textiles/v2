import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { PAYMENT_SUBMISSIONS_MODULE } from "../modules/payment_submissions"
import { INTERNAL_PAYMENTS_MODULE } from "../modules/internal_payments"

/**
 * Can ONE payment method be paid to by TWO submissions? (#1636 fallout)
 *
 * Approving a payout links the submission to the bank/wallet record it was paid
 * to. If that link is defined with neither side a list, Medusa validates
 * uniqueness on BOTH foreign keys — `$or: [submission_id, method_id]` — so the
 * SECOND payout to the same bank account is refused with
 * "Cannot create multiple links between 'payment_submissions' and
 * 'internal_payments'". That is every partner's second payout onwards.
 *
 * This drives the real link registry with synthetic ids. Link tables carry no
 * cross-module foreign keys, so the ids need not exist — which is what makes
 * this checkable without inventing a partner, a run and a payout.
 *
 * Read-only in effect: both links are dismissed at the end, in a `finally`, so
 * a failure part-way still cleans up.
 *
 *   npx medusa exec ./src/scripts/check-paid-to-link-cardinality.ts
 */
export default async function checkPaidToLinkCardinality({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const link: any = container.resolve(ContainerRegistrationKeys.LINK)

  const method = "ipd_cardinality_probe"
  const subA = "psub_cardinality_probe_a"
  const subB = "psub_cardinality_probe_b"

  const def = (submissionId: string) => ({
    [PAYMENT_SUBMISSIONS_MODULE]: { payment_submission_id: submissionId },
    [INTERNAL_PAYMENTS_MODULE]: { internal_payment_details_id: method },
  })

  let first = "not attempted"
  let second = "not attempted"

  try {
    await link.create([def(subA)])
    first = "OK"

    try {
      // The real-world case: a second payout to the SAME bank account.
      await link.create([def(subB)])
      second = "OK"
    } catch (e: any) {
      second = `THREW "${e?.message ?? String(e)}"`
    }
  } catch (e: any) {
    first = `THREW "${e?.message ?? String(e)}"`
  } finally {
    await link.dismiss([def(subA)]).catch(() => {})
    await link.dismiss([def(subB)]).catch(() => {})
  }

  /**
   * The other half, and the one a "just make it many-to-many" fix would quietly
   * lose: a submission must still be paid to exactly ONE method. Approving a
   * payout to two bank accounts is a worse bug than the one being fixed.
   */
  let twoMethods = "not attempted"
  const otherMethod = "ipd_cardinality_probe_other"
  const defOther = {
    [PAYMENT_SUBMISSIONS_MODULE]: { payment_submission_id: subA },
    [INTERNAL_PAYMENTS_MODULE]: { internal_payment_details_id: otherMethod },
  }
  try {
    await link.create([def(subA)])
    try {
      await link.create([defOther])
      twoMethods = "OK — 🔴 a submission was linked to TWO methods"
    } catch (e: any) {
      twoMethods = `refused (correct): "${e?.message ?? String(e)}"`
    }
  } finally {
    await link.dismiss([def(subA)]).catch(() => {})
    await link.dismiss([defOther]).catch(() => {})
  }

  logger.info(`[paid-to-link] first submission  -> ${first}`)
  logger.info(`[paid-to-link] two methods on one submission -> ${twoMethods}`)
  logger.info(`[paid-to-link] second submission -> ${second}`)
  logger.info(
    first === "OK" && second === "OK"
      ? "[paid-to-link] ✅ PASS — one payment method can receive many payouts."
      : "[paid-to-link] 🔴 FAIL — a payment method can only ever be paid once. Every partner's second payout is blocked."
  )
}

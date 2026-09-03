import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { PAYMENT_SUBMISSIONS_MODULE } from "../modules/payment_submissions"
import { INTERNAL_PAYMENTS_MODULE } from "../modules/internal_payments"

/**
 * Does `submission.paid_to` come back as an OBJECT or an ARRAY?
 *
 * Changing a link's `isList` changes the read shape, and a to-one that becomes
 * a to-many turns every `paid_to.id` into `undefined` and every `.filter` on it
 * into a 500 — silently, because `query.graph` does not complain. Reasoning
 * from the definition is not good enough here; this measures it.
 *
 *   npx medusa exec ./src/scripts/check-paid-to-read-shape.ts
 */
export default async function checkPaidToReadShape({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const link: any = container.resolve(ContainerRegistrationKeys.LINK)
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

  const submissionService: any = container.resolve(PAYMENT_SUBMISSIONS_MODULE)
  const paymentService: any = container.resolve(INTERNAL_PAYMENTS_MODULE)

  const [submission] = await submissionService.listPaymentSubmissions({}, { take: 1 })
  const [method] = await paymentService.listPaymentDetails({}, { take: 1 })

  if (!submission || !method) {
    logger.warn(
      `[shape] Need one payment_submission and one internal_payment_details row locally — found submission=${!!submission} method=${!!method}. Cannot measure.`
    )
    return
  }

  const def = {
    [PAYMENT_SUBMISSIONS_MODULE]: { payment_submission_id: submission.id },
    [INTERNAL_PAYMENTS_MODULE]: { internal_payment_details_id: method.id },
  }

  try {
    await link.create([def])
  } catch (e: any) {
    logger.info(`[shape] (link already present or refused: ${e?.message})`)
  }

  try {
    const { data } = await query.graph({
      entity: "payment_submission",
      fields: ["id", "paid_to.*"],
      filters: { id: submission.id },
    })
    const row: any = (data || [])[0]
    const paidTo = row?.paid_to
    logger.info(
      `[shape] submission.paid_to -> ${
        paidTo === undefined
          ? "UNDEFINED (no key returned)"
          : Array.isArray(paidTo)
            ? `ARRAY(${paidTo.length})`
            : "OBJECT"
      } :: ${JSON.stringify(paidTo)?.slice(0, 200)}`
    )
  } catch (e: any) {
    logger.error(`[shape] read failed: ${e?.message}`)
  } finally {
    await link.dismiss([def]).catch(() => {})
  }
}

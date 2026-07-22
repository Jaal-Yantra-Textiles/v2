import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { Subscriber } from "../types"
import { KIT_MODULE } from "../../../../modules/kit"
import type KitService from "../../../../modules/kit/service"
import { EMAIL_SUPPRESSION_MODULE } from "../../../../modules/email_suppression"
import { reasonSuppresses, normalizeEmail } from "../../../../modules/email_suppression/suppress-core"

export const syncSubscribersToKitStepId = "sync-subscribers-to-kit"

// Kit API-key auth is capped at 120 req / rolling 60s. Each subscriber costs 2
// requests (upsert + tag), so we pace at ~1 subscriber/sec to stay well under.
const PER_SUBSCRIBER_DELAY_MS = 1100

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Sync-time gate + push for the Kit broadcast path.
 *
 * `getSubscribersStep` already drops bounced/unsubscribed/dormant addresses;
 * this step additionally hard-excludes anything in the centralized
 * `email_suppression` ledger, then upserts + tags each survivor in Kit so the
 * broadcast (filtered on the tag) reaches exactly the addresses we'd mail.
 *
 * Gating happens HERE (at sync) rather than at send: Kit decides recipients by
 * tag, so a suppressed address simply never gets tagged.
 */
export const syncSubscribersToKitStep = createStep(
  syncSubscribersToKitStepId,
  async (input: { subscribers: Subscriber[] }, { container }) => {
    const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
    const kit = container.resolve(KIT_MODULE) as KitService
    const suppression: any = container.resolve(EMAIL_SUPPRESSION_MODULE)

    const subscribers = input.subscribers || []
    const emails = subscribers.map((s) => normalizeEmail(s.email)).filter(Boolean)

    // Hard-exclude via the suppression ledger (a suppressing reason only).
    const suppressed = new Set<string>()
    if (emails.length) {
      try {
        const rows: any[] = await suppression.listEmailSuppressions(
          { email: emails },
          { take: emails.length }
        )
        for (const row of rows || []) {
          if (reasonSuppresses(row.reason)) {
            suppressed.add(normalizeEmail(row.email))
          }
        }
      } catch (e) {
        logger.warn(
          `[syncSubscribersToKit] Suppression lookup failed, proceeding without it: ${(e as Error).message}`
        )
      }
    }

    const eligible = subscribers.filter(
      (s) => !suppressed.has(normalizeEmail(s.email))
    )
    logger.info(
      `[syncSubscribersToKit] ${eligible.length} eligible / ${subscribers.length} subscribers (${suppressed.size} suppressed)`
    )

    let synced = 0
    let failed = 0
    for (const sub of eligible) {
      const email = normalizeEmail(sub.email)
      if (!email) continue
      try {
        await kit.upsertSubscriber({ email, first_name: sub.first_name })
        await kit.tagSubscriber(email)
        synced++
      } catch (e) {
        failed++
        logger.error(
          `[syncSubscribersToKit] Failed to sync ${email}: ${(e as Error).message}`
        )
      }
      await sleep(PER_SUBSCRIBER_DELAY_MS)
    }

    logger.info(
      `[syncSubscribersToKit] Synced ${synced}, failed ${failed} (recipient_count=${synced})`
    )
    return new StepResponse({ syncedCount: synced, failedCount: failed })
  }
)

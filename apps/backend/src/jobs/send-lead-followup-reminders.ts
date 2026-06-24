import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IEventBusModuleService } from "@medusajs/framework/types"

import { SOCIALS_MODULE } from "../modules/socials"
import type SocialsService from "../modules/socials/service"
import {
  LEAD_FOLLOWUP_DUE_EVENT,
  selectLeadsNeedingFollowup,
} from "../workflows/leads/lib/email-lead"

/**
 * #460 slice 1 — email lead follow-up nudge.
 *
 * Finds email-source leads (captured by `ingest-lead-emails`) that are still
 * open (`new`/`contacted`) with no activity after N days and emits a
 * `lead.followup_due` event for each. That event is picked up by the
 * visual-flow event trigger, so the operator can wire a follow-up flow (send an
 * email, create a task, ping a channel) with no code.
 *
 * Idempotent: each nudged lead is stamped with `metadata.followup_nudged_at`, so
 * a re-run never re-fires. Fail-soft — a single bad lead never aborts the batch.
 */
const MIN_AGE_DAYS = Number(process.env.LEADS_FOLLOWUP_MIN_AGE_DAYS || 3)
const MAX_BATCH = Number(process.env.LEADS_FOLLOWUP_MAX_BATCH || 100)

export default async function sendLeadFollowupReminders(
  container: MedusaContainer
) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const socials = container.resolve(SOCIALS_MODULE) as SocialsService
  const eventBus = container.resolve(
    Modules.EVENT_BUS
  ) as IEventBusModuleService

  try {
    const leads = (await socials.listLeads(
      { source_platform: "email" },
      { take: 1000 }
    )) as any[]

    const due = selectLeadsNeedingFollowup(leads as any, {
      minAgeDays: MIN_AGE_DAYS,
      maxBatch: MAX_BATCH,
    })

    if (due.length === 0) {
      return
    }

    let nudged = 0
    let skipped = 0
    for (const lead of due) {
      try {
        await eventBus.emit({
          name: LEAD_FOLLOWUP_DUE_EVENT,
          data: {
            id: lead.id,
            email: lead.email || null,
            full_name: lead.full_name || null,
            status: lead.status || "new",
          },
        })

        await socials.updateLeads([
          {
            id: lead.id,
            metadata: {
              ...(lead.metadata || {}),
              followup_nudged_at: new Date().toISOString(),
            },
          },
        ] as any)
        nudged++
      } catch (e: any) {
        skipped++
        logger.warn(
          `[lead-followup] failed for lead ${lead.id}: ${e?.message || e}`
        )
      }
    }

    if (nudged + skipped > 0) {
      logger.info(`[lead-followup] done — nudged=${nudged} skipped=${skipped}`)
    }
  } catch (e: any) {
    logger.error(`[lead-followup] batch error: ${e?.message || e}`)
  }
}

export const config = {
  name: "send-lead-followup-reminders",
  schedule: "0 9 * * *", // daily at 09:00
}

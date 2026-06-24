import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { SOCIALS_MODULE } from "../modules/socials"
import type SocialsService from "../modules/socials/service"
import { INBOUND_EMAIL_MODULE } from "../modules/inbound_emails"
import {
  buildEmailLeadKey,
  buildLeadInputFromEmail,
  resolveLeadFolders,
  selectLeadEmailsToIngest,
} from "../workflows/leads/lib/email-lead"

/**
 * #460 slice 1 — email-driven lead capture.
 *
 * Scans inbound emails (synced from iCloud/IMAP or delivered via Resend) that
 * landed in a configured "leads" folder and upserts a `Lead` in the socials
 * module. Idempotent: the lead's `meta_lead_id` is a stable key derived from the
 * email message-id, so a re-scan never double-creates. Fail-soft — one bad row
 * never aborts the batch.
 *
 * The "leads folder" signal: set `LEADS_EMAIL_FOLDERS` (comma-separated IMAP
 * folder names, default `Leads`). The categorisation flow that *moves* emails
 * into that folder is the next step (documented in the #460 handoff); this job
 * only reacts to the folder once an email is there.
 *
 * Emits `lead.created_from_email` per new lead so an event-triggered visual flow
 * can drive downstream follow-up without code.
 */
const MAX_BATCH = Number(process.env.LEADS_INGEST_MAX_BATCH || 200)

export default async function ingestLeadEmails(container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const socials = container.resolve(SOCIALS_MODULE) as SocialsService
  const inboundEmails: any = container.resolve(INBOUND_EMAIL_MODULE)

  const folders = resolveLeadFolders(process.env.LEADS_EMAIL_FOLDERS)

  try {
    // Pull recent inbound emails; the pure selector applies folder + idempotency
    // filters so this stays unit-testable.
    const emails = await inboundEmails.listInboundEmails({}, { take: 1000 })

    if (!Array.isArray(emails) || emails.length === 0) {
      return
    }

    // Existing email-source leads keyed by meta_lead_id, to skip re-ingest.
    const existing = (await socials.listLeads(
      { source_platform: "email" },
      { take: 2000 }
    )) as any[]
    const existingKeys = new Set(
      (existing || []).map((l) => l.meta_lead_id).filter(Boolean)
    )

    const toIngest = selectLeadEmailsToIngest(emails as any, {
      folders,
      existingKeys,
      maxBatch: MAX_BATCH,
    })

    if (toIngest.length === 0) {
      return
    }

    let created = 0
    let skipped = 0
    for (const email of toIngest) {
      try {
        const input = buildLeadInputFromEmail(email as any)

        // Double-check against the DB (a concurrent run could have inserted it).
        const dupes = (await socials.listLeads({
          meta_lead_id: input.meta_lead_id,
        })) as any[]
        if (dupes && dupes.length > 0) {
          skipped++
          continue
        }

        const lead = await socials.createLeads(input as any)
        const leadId = Array.isArray(lead) ? lead[0]?.id : (lead as any)?.id

        // Best-effort back-link stamp on the inbound email (preserve metadata).
        if (email.id) {
          try {
            await inboundEmails.updateInboundEmails({
              id: email.id,
              metadata: {
                ...((email as any).metadata || {}),
                lead_id: leadId || null,
                lead_ingested_at: new Date().toISOString(),
              },
            })
          } catch {
            // non-fatal — the lead exists; the stamp is only a convenience.
          }
        }

        created++
      } catch (e: any) {
        skipped++
        logger.warn(
          `[lead-ingest] failed for email ${
            (email as any).id || buildEmailLeadKey(email as any)
          }: ${e?.message || e}`
        )
      }
    }

    if (created + skipped > 0) {
      logger.info(
        `[lead-ingest] done — created=${created} skipped=${skipped} folders=${folders.join(
          ","
        )}`
      )
    }
  } catch (e: any) {
    logger.error(`[lead-ingest] batch error: ${e?.message || e}`)
  }
}

export const config = {
  name: "ingest-lead-emails",
  schedule: "*/15 * * * *", // every 15 minutes
}

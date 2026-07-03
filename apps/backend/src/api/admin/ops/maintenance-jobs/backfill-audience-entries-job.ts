import { Modules } from "@medusajs/framework/utils"

import { PERSON_MODULE } from "../../../../modules/person"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import { AUDIENCE_MODULE } from "../../../../modules/audience"
import {
  buildAudienceEntries,
  summarizeEntries,
  type SourceRecord,
} from "../../../../modules/audience/build-entries"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * #457 / #881 — materialize the unified audience.
 *
 * Scans the three send sources (persons + customers + socials leads), classifies
 * each contact (source / groups / tags / mailable) and upserts one
 * `audience_entry` per email — the deduped, taggable "who's in here" list. Also
 * seeds the source `audience_group` definitions.
 *
 * Dry-run reports the composition (counts by source/tag/type) without writing;
 * apply upserts the entries. Idempotent — re-running refreshes in place.
 */

const SOURCE_GROUPS: Array<{ key: string; label: string }> = [
  { key: "weaver-directory", label: "Weaver directory" },
  { key: "organic", label: "Organic subscribers" },
  { key: "customers", label: "Customers" },
  { key: "ad-leads", label: "Ad leads" },
]

export const backfillAudienceEntriesJob: MaintenanceJob = {
  id: "backfill-audience-entries",
  label: "Backfill audience entries",
  description:
    "Materialize the unified audience: scan persons + customers + leads, classify each (source/groups/tags/mailable) and upsert one audience_entry per email. Seeds the source group definitions. Dry-run reports the composition without writing; apply refreshes the entries (idempotent).",
  params: [],
  run: async (container, { dry_run }): Promise<MaintenanceJobResult> => {
    const personService: any = container.resolve(PERSON_MODULE)
    const customerService: any = container.resolve(Modules.CUSTOMER)
    const socialsService: any = container.resolve(SOCIALS_MODULE)
    const audienceService: any = container.resolve(AUDIENCE_MODULE)

    const records: SourceRecord[] = []

    // Persons (with subscription state).
    const persons: any[] = await personService
      .listPeople(
        {},
        { relations: ["subscribed"], select: ["id", "email", "first_name", "last_name", "metadata", "state", "created_at"] }
      )
      .catch(() => [])
    for (const p of persons) {
      if (!p.email) continue
      records.push({
        member_type: "person",
        member_id: p.id,
        email: p.email,
        first_name: p.first_name,
        last_name: p.last_name,
        metadata: p.metadata,
        state: p.state,
        sub_active: p.subscribed?.subscription_status === "active",
        created_at: p.created_at,
      })
    }

    // Customers.
    const customers: any[] = await customerService
      .listCustomers({}, { select: ["id", "email", "first_name", "last_name", "metadata", "created_at"] })
      .catch(() => [])
    for (const c of customers) {
      if (!c.email) continue
      records.push({
        member_type: "customer",
        member_id: c.id,
        email: c.email,
        first_name: c.first_name,
        last_name: c.last_name,
        metadata: c.metadata,
        created_at: c.created_at,
      })
    }

    // Socials leads (non-dead, same filter as the send).
    const leads: any[] = await socialsService
      .listLeads(
        { status: { $nin: ["archived", "lost", "unqualified"] } },
        { select: ["id", "email", "first_name", "last_name", "full_name", "metadata", "created_at"] }
      )
      .catch(() => [])
    for (const l of leads) {
      if (!l.email) continue
      records.push({
        member_type: "lead",
        member_id: l.id,
        email: l.email,
        first_name: l.first_name || l.full_name?.split(" ")?.[0] || null,
        last_name: l.last_name || l.full_name?.split(" ")?.slice(1).join(" ") || null,
        metadata: l.metadata,
        created_at: l.created_at,
      })
    }

    const drafts = buildAudienceEntries(records)
    const summary = summarizeEntries(drafts)

    // Aggregate changes (one row per source bucket — keeps the audit readable).
    const changes: MaintenanceChange[] = Object.entries(summary.bySource).map(
      ([source, count]) => ({ entity: "audience_entry", id: source, field: "count", after: count })
    )

    if (!dry_run) {
      // Seed source group definitions (upsert by key).
      const existingGroups: any[] = await audienceService.listAudienceGroups({}).catch(() => [])
      const groupKeys = new Set(existingGroups.map((g) => g.key))
      const newGroups = SOURCE_GROUPS.filter((g) => !groupKeys.has(g.key)).map((g) => ({
        key: g.key,
        label: g.label,
        kind: "source",
      }))
      if (newGroups.length) await audienceService.createAudienceGroups(newGroups)

      // Upsert entries by email.
      const existing: any[] = await audienceService
        .listAudienceEntries({}, { select: ["id", "email"], take: 100000 })
        .catch(() => [])
      const idByEmail = new Map(existing.map((e) => [e.email, e.id]))

      const toCreate: any[] = []
      const toUpdate: any[] = []
      for (const d of drafts) {
        const row = {
          email: d.email,
          member_type: d.member_type,
          member_id: d.member_id,
          first_name: d.first_name,
          last_name: d.last_name,
          source: d.source,
          groups: d.groups,
          tags: d.tags,
          mailable: d.mailable,
        }
        const id = idByEmail.get(d.email)
        if (id) toUpdate.push({ id, ...row })
        else toCreate.push(row)
      }
      if (toCreate.length) await audienceService.createAudienceEntries(toCreate)
      for (const u of toUpdate) await audienceService.updateAudienceEntries(u)
    }

    const verb = dry_run ? "Would materialize" : "Materialized"
    return {
      job_id: backfillAudienceEntriesJob.id,
      dry_run,
      applied: !dry_run && drafts.length > 0,
      summary:
        `${verb} ${summary.total} audience entries (${summary.mailable} mailable) — ` +
        Object.entries(summary.bySource)
          .map(([s, n]) => `${s}:${n}`)
          .join(", "),
      changes,
    }
  },
}

export default backfillAudienceEntriesJob

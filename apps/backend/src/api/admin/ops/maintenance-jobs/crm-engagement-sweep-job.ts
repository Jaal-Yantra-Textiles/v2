import { Modules } from "@medusajs/framework/utils"

import { CRM_MODULE } from "../../../../modules/crm"
import {
  CRM_ENGAGEMENT_NEEDS_ACTION,
  deriveEngagement,
  type CrmEngagementState,
} from "../../../../modules/crm/activity"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * Recompute every contact's engagement state, and emit an event when one
 * CHANGES.
 *
 * This is the clock the conversation axis needs. Most engagement transitions
 * are driven by an activity arriving, and `recordCrmActivity` handles those
 * synchronously. But two transitions are driven by time passing and nothing
 * else — a follow-up coming due, and a contact going quiet long enough to count
 * as stalled. Without a sweep those states are only ever discovered by someone
 * opening the record.
 *
 * ## The events are the point
 *
 * `visual-flow-event-trigger` already routes any emitted event to flows whose
 * trigger_config matches — including by wildcard (`crm.*`). So emitting here is
 * what lets a flow say "when a follow-up comes due, send the WhatsApp template
 * and log the send", with no new subscriber and no new plumbing.
 *
 * ⚠️ Events fire ONLY on transition, never on every sweep. A contact that sits
 * at `follow_up_due` because nobody has acted must not re-trigger the flow each
 * run — that is how an automation turns into a person receiving the same
 * message every morning. Re-notification is a flow's decision (it can schedule
 * its own repeat), not something this job imposes.
 */

/** Transitions worth telling the rest of the system about. */
const EVENT_BY_STATE: Partial<Record<CrmEngagementState, string>> = {
  follow_up_due: "crm.follow_up_due",
  stalled: "crm.contact_stalled",
  in_conversation: "crm.contact_replied",
  do_not_contact: "crm.contact_opted_out",
}

export const crmEngagementSweepJob: MaintenanceJob = {
  id: "crm-engagement-sweep",
  label: "Sweep CRM engagement states",
  description:
    "Recompute every CRM contact's engagement state from its activity log, and emit an event for each contact whose state CHANGED (crm.follow_up_due, crm.contact_stalled, crm.contact_replied, crm.contact_opted_out) so visual flows can act on it. Time-driven transitions — a follow-up coming due, a contact going quiet — are only discovered here. Dry-run reports the transitions without writing or emitting.",
  params: [
    {
      name: "person_id",
      type: "string",
      required: false,
      description: "Sweep only this contact. Omit to sweep all of them.",
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const crmService: any = container.resolve(CRM_MODULE)
    const eventBus: any = container.resolve(Modules.EVENT_BUS)

    const personId = (params.person_id as string | undefined)?.trim()
    const people: any[] = personId
      ? [await crmService.retrieveCrmPerson(personId)]
      : await crmService.listCrmPeople({}, { take: null })

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    const events: Array<{ name: string; data: Record<string, unknown> }> = []
    const now = new Date()
    let applied = false
    let needsAction = 0

    for (const person of people) {
      if (!person?.id) continue
      try {
        if (dry_run) {
          // Derive without persisting, so a dry run reports exactly the
          // transitions an apply would make.
          const activities = await crmService.listCrmActivities(
            { related_type: "person", related_id: person.id },
            { take: null }
          )
          const snapshot = deriveEngagement(activities, {
            now,
            scheduledFollowUpAt: person.next_follow_up_at ?? null,
          })
          if (snapshot.engagement_state !== person.engagement_state) {
            changes.push({
              entity: "crm_person",
              id: person.id,
              field: "engagement_state",
              before: person.engagement_state ?? null,
              after: snapshot.engagement_state,
            })
          }
          if (
            (CRM_ENGAGEMENT_NEEDS_ACTION as readonly string[]).includes(
              snapshot.engagement_state
            )
          ) {
            needsAction++
          }
          continue
        }

        const result = await crmService.refreshCrmEngagement(person.id, now)

        if (
          (CRM_ENGAGEMENT_NEEDS_ACTION as readonly string[]).includes(
            result.engagement_state
          )
        ) {
          needsAction++
        }

        const transitioned = result.previous_state !== result.engagement_state
        if (!transitioned) continue

        applied = true
        changes.push({
          entity: "crm_person",
          id: person.id,
          field: "engagement_state",
          before: result.previous_state,
          after: result.engagement_state,
        })

        const eventName = EVENT_BY_STATE[result.engagement_state as CrmEngagementState]
        if (eventName) {
          events.push({
            name: eventName,
            data: {
              crm_person_id: person.id,
              email: person.email ?? null,
              phone: person.phone ?? null,
              engagement_state: result.engagement_state,
              previous_state: result.previous_state,
              last_inbound_at: result.last_inbound_at,
              last_outbound_at: result.last_outbound_at,
              outbound_attempts: result.outbound_attempts,
              next_follow_up_at: result.next_follow_up_at,
            },
          })
        }
      } catch (e: any) {
        // One unreadable contact must not abort the sweep; the rest still need
        // their states refreshed.
        errors.push({ id: person.id, message: e?.message ?? String(e) })
      }
    }

    // Emitted after the loop so a contact's state is already persisted before a
    // flow can read it back. A flow triggered mid-loop could otherwise fetch the
    // contact and see the state the sweep is in the middle of replacing.
    for (const evt of events) {
      await eventBus.emit(evt).catch(() => {})
    }

    const verb = dry_run ? "Would transition" : "Transitioned"
    return {
      job_id: crmEngagementSweepJob.id,
      dry_run,
      applied,
      summary: `${verb} ${changes.length} of ${people.length} contact(s); ${needsAction} now need action${
        dry_run ? "" : `; emitted ${events.length} event(s)`
      }.${errors.length ? ` ${errors.length} failed.` : ""}`,
      changes,
      ...(errors.length ? { errors } : {}),
    }
  },
}

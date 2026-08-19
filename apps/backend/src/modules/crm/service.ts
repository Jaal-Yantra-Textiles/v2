import type { ModelRepository } from "@jytextiles/mikrohyperbee";

import {
  deriveEngagement,
  summarizeActivity,
  type EngagementActivity,
} from "./activity";

/**
 * CrmService — the module service for the Hyperbee-only CRM module.
 *
 * No DML models, no MedusaService({ ... }) generated layer, no Postgres. The
 * data structure lives in the Hyperbee contracts (dal/hyperbee-crm-service.ts),
 * and the loader registers per-entity ModelRepository instances
 * (crmCompanyService, crmPersonService, ...) into the module container. This
 * class lazily resolves them and exposes the conventional generated-style
 * method names (createCrmCompanies, listAndCountCrmPeople, ...) so routes and
 * workflows call the same surface regardless of backend.
 */
class CrmService {
  protected readonly __container__: any;

  constructor(container: any) {
    this.__container__ = container;
  }

  private repo(name: string): ModelRepository {
    // In the Medusa runtime the module service is constructed with the Awilix
    // *cradle* (a proxy), not a container — it has no `.resolve()` method, and
    // even reading `.resolve` makes Awilix look up a registration named
    // "resolve" ("Could not resolve 'resolve'"), which 500-ed every
    // /admin/crm/* route. Registrations are read as PROPERTIES on the cradle,
    // so index into it. The e2e mock container exposes the same properties, so
    // this works there too.
    return (this.__container__ as any)[name];
  }

  // ── companies ────────────────────────────────────────────────────────────────
  async createCrmCompanies(data: any) {
    return this.repo("crmCompanyService").create(data);
  }
  async retrieveCrmCompany(id: string) {
    return this.repo("crmCompanyService").retrieve(id);
  }
  async listCrmCompanies(filters?: any, config?: any) {
    return this.repo("crmCompanyService").list(filters, config);
  }
  async listAndCountCrmCompanies(filters?: any, config?: any) {
    return this.repo("crmCompanyService").listAndCount(filters, config);
  }
  async updateCrmCompanies(data: any) {
    return this.repo("crmCompanyService").update(data);
  }
  async deleteCrmCompanies(selector: any) {
    return this.repo("crmCompanyService").delete(selector);
  }

  // ── people ───────────────────────────────────────────────────────────────────
  async createCrmPeople(data: any) {
    return this.repo("crmPersonService").create(data);
  }
  async retrieveCrmPerson(id: string) {
    return this.repo("crmPersonService").retrieve(id);
  }
  async listCrmPeople(filters?: any, config?: any) {
    return this.repo("crmPersonService").list(filters, config);
  }
  async listAndCountCrmPeople(filters?: any, config?: any) {
    return this.repo("crmPersonService").listAndCount(filters, config);
  }
  async updateCrmPeople(data: any) {
    return this.repo("crmPersonService").update(data);
  }
  async deleteCrmPeople(selector: any) {
    return this.repo("crmPersonService").delete(selector);
  }

  // ── opportunities ─────────────────────────────────────────────────────────────
  async createCrmOpportunities(data: any) {
    return this.repo("crmOpportunityService").create(data);
  }
  async retrieveCrmOpportunity(id: string) {
    return this.repo("crmOpportunityService").retrieve(id);
  }
  async listCrmOpportunities(filters?: any, config?: any) {
    return this.repo("crmOpportunityService").list(filters, config);
  }
  async listAndCountCrmOpportunities(filters?: any, config?: any) {
    return this.repo("crmOpportunityService").listAndCount(filters, config);
  }
  async updateCrmOpportunities(data: any) {
    return this.repo("crmOpportunityService").update(data);
  }
  async deleteCrmOpportunities(selector: any) {
    return this.repo("crmOpportunityService").delete(selector);
  }

  // ── notes ─────────────────────────────────────────────────────────────────────
  async createCrmNotes(data: any) {
    return this.repo("crmNoteService").create(data);
  }
  async retrieveCrmNote(id: string) {
    return this.repo("crmNoteService").retrieve(id);
  }
  async listCrmNotes(filters?: any, config?: any) {
    return this.repo("crmNoteService").list(filters, config);
  }
  async listAndCountCrmNotes(filters?: any, config?: any) {
    return this.repo("crmNoteService").listAndCount(filters, config);
  }
  async updateCrmNotes(data: any) {
    return this.repo("crmNoteService").update(data);
  }
  async deleteCrmNotes(selector: any) {
    return this.repo("crmNoteService").delete(selector);
  }

  // ── tasks ─────────────────────────────────────────────────────────────────────
  async createCrmTasks(data: any) {
    return this.repo("crmTaskService").create(data);
  }
  async retrieveCrmTask(id: string) {
    return this.repo("crmTaskService").retrieve(id);
  }
  async listCrmTasks(filters?: any, config?: any) {
    return this.repo("crmTaskService").list(filters, config);
  }
  async listAndCountCrmTasks(filters?: any, config?: any) {
    return this.repo("crmTaskService").listAndCount(filters, config);
  }
  async updateCrmTasks(data: any) {
    return this.repo("crmTaskService").update(data);
  }
  async deleteCrmTasks(selector: any) {
    return this.repo("crmTaskService").delete(selector);
  }

  // ── activities ────────────────────────────────────────────────────────────
  async createCrmActivities(data: any) {
    return this.repo("crmActivityService").create(data);
  }
  async retrieveCrmActivity(id: string) {
    return this.repo("crmActivityService").retrieve(id);
  }
  async listCrmActivities(filters?: any, config?: any) {
    return this.repo("crmActivityService").list(filters, config);
  }
  async listAndCountCrmActivities(filters?: any, config?: any) {
    return this.repo("crmActivityService").listAndCount(filters, config);
  }
  async updateCrmActivities(data: any) {
    return this.repo("crmActivityService").update(data);
  }
  async deleteCrmActivities(selector: any) {
    return this.repo("crmActivityService").delete(selector);
  }

  // ── the two composed operations ───────────────────────────────────────────

  /**
   * Record an interaction AND refresh the contact's engagement cache.
   *
   * These are one operation on purpose. An activity written without the
   * recompute leaves `engagement_state` describing a conversation that has
   * since moved on — and since flows select on that field, a stale value does
   * not merely look wrong, it decides who gets messaged. Every write path
   * (route, subscriber, flow, MCP tool) goes through here.
   *
   * The recompute is best-effort: the interaction genuinely happened, so
   * failing to update a derived cache must not lose the record of it. A failed
   * recompute is repaired by the next activity or by the sweep job.
   */
  async recordCrmActivity(input: any) {
    const occurred_at = input.occurred_at ?? new Date().toISOString();
    const activity = await this.createCrmActivities({
      ...input,
      occurred_at,
      summary: input.summary ?? summarizeActivity({ ...input, occurred_at }),
    });

    if (input.related_type === "person" && input.related_id) {
      await this.refreshCrmEngagement(input.related_id).catch(() => {});
    }
    return activity;
  }

  /**
   * Recompute one contact's engagement snapshot from its activity log.
   *
   * Returns the snapshot, and writes it only when something actually changed —
   * so a settled contact costs a read and no write. That matters more here
   * than in Postgres: every write is an HTTP round trip to the CRM node and an
   * Autobase append that replicates.
   */
  async refreshCrmEngagement(personId: string, now: Date = new Date()) {
    const person: any = await this.retrieveCrmPerson(personId);
    const activities: EngagementActivity[] = await this.listCrmActivities(
      { related_type: "person", related_id: personId },
      { take: null }
    );

    const snapshot = deriveEngagement(activities, {
      now,
      scheduledFollowUpAt: person?.next_follow_up_at ?? null,
    });

    const changed =
      person?.engagement_state !== snapshot.engagement_state ||
      person?.last_activity_at !== snapshot.last_activity_at ||
      person?.last_inbound_at !== snapshot.last_inbound_at ||
      person?.last_outbound_at !== snapshot.last_outbound_at ||
      (person?.next_follow_up_at ?? null) !== snapshot.next_follow_up_at;

    if (changed) {
      await this.updateCrmPeople({
        id: personId,
        engagement_state: snapshot.engagement_state,
        last_activity_at: snapshot.last_activity_at,
        last_inbound_at: snapshot.last_inbound_at,
        last_outbound_at: snapshot.last_outbound_at,
        next_follow_up_at: snapshot.next_follow_up_at,
      });
    }

    return { ...snapshot, changed, previous_state: person?.engagement_state ?? null };
  }
}

export default CrmService;

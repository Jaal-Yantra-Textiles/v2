import type { ModelRepository } from "@jytextiles/mikrohyperbee";

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
}

export default CrmService;

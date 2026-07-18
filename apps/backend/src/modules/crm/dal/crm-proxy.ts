/**
 * Proxy-mode CRM repositories — the Medusa side of Topology A. Instead of holding
 * a Hyperbee in-process, each per-model repository forwards create/list/retrieve/
 * update/delete to the always-on CRM node (node/server.ts) over HTTP, exactly the
 * way the census reader proxies to its standalone reader. Medusa stays stateless
 * (no native hypercore stack in the API tasks); the node is the durable Autobase
 * writer.
 *
 * The node returns `{ type, message }` on contract errors; we re-raise them as the
 * MedusaError the routes already expect, so the surface is identical to the
 * embedded DAL.
 */
import { MedusaError } from "@medusajs/framework/utils";

import type { ModelRepository } from "@jytextiles/mikrohyperbee";

const SEGMENT_BY_MODEL: Record<string, string> = {
  crm_company: "companies",
  crm_person: "people",
  crm_opportunity: "opportunities",
  crm_note: "notes",
  crm_task: "tasks",
};

const ERROR_TYPE: Record<string, string> = {
  not_found: MedusaError.Types.NOT_FOUND,
  invalid_data: MedusaError.Types.INVALID_DATA,
  not_unique: MedusaError.Types.INVALID_DATA,
  not_allowed: MedusaError.Types.NOT_ALLOWED,
};

class CrmProxyRepository implements ModelRepository {
  constructor(
    private baseUrl: string,
    private segment: string,
    private token?: string
  ) {}

  private async call(method: string, path: string, body?: unknown): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new MedusaError(
        ERROR_TYPE[data?.type] ?? MedusaError.Types.UNEXPECTED_STATE,
        data?.message || `crm node ${method} ${path} → HTTP ${res.status}`
      );
    }
    return data;
  }

  private qs(filters?: Record<string, any>, config?: { take?: number | null; skip?: number }): string {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filters ?? {})) {
      if (v === undefined || v === null || typeof v === "object") continue; // node handles equality filters
      p.set(k, String(v));
    }
    if (config?.take != null) p.set("limit", String(config.take));
    if (config?.skip) p.set("offset", String(config.skip));
    const s = p.toString();
    return s ? `?${s}` : "";
  }

  async create(data: any): Promise<any> {
    const { record } = await this.call("POST", `/crm/${this.segment}`, data);
    return record;
  }
  async retrieve(id: string): Promise<any> {
    const { record } = await this.call("GET", `/crm/${this.segment}/${encodeURIComponent(id)}`);
    return record;
  }
  async list(filters: any = {}, config: any = {}): Promise<any[]> {
    const { rows } = await this.call("GET", `/crm/${this.segment}${this.qs(filters, config)}`);
    return rows ?? [];
  }
  async listAndCount(filters: any = {}, config: any = {}): Promise<[any[], number]> {
    const { rows, count } = await this.call("GET", `/crm/${this.segment}${this.qs(filters, config)}`);
    return [rows ?? [], count ?? 0];
  }
  async update(data: any): Promise<any> {
    const { id, ...rest } = data;
    const { record } = await this.call("POST", `/crm/${this.segment}/${encodeURIComponent(id)}`, rest);
    return record;
  }
  async upsert(data: any): Promise<any> {
    // The node has no upsert route; emulate create-or-update by id.
    if (data?.id) {
      try {
        return await this.update(data);
      } catch (e: any) {
        if (e?.type !== MedusaError.Types.NOT_FOUND) throw e;
      }
    }
    return this.create(data);
  }
  async delete(selector: string | string[] | Record<string, any> | Record<string, any>[]): Promise<void> {
    const ids: string[] = [];
    const targets = Array.isArray(selector) ? selector : [selector];
    for (const t of targets) {
      if (typeof t === "string") ids.push(t);
      else if (t && typeof t === "object") {
        // filter-object delete → resolve to ids via the node, then delete each.
        const rows = await this.list(t, { take: null });
        for (const r of rows) ids.push(String(r.id));
      }
    }
    for (const id of ids) {
      await this.call("DELETE", `/crm/${this.segment}/${encodeURIComponent(id)}`);
    }
  }
  async softDelete(): Promise<[any[], Record<string, unknown>]> {
    return [[], {}];
  }
  async restore(): Promise<[any[], Record<string, unknown>]> {
    return [[], {}];
  }
}

export interface CrmRepositories {
  crmCompanyService: ModelRepository;
  crmPersonService: ModelRepository;
  crmOpportunityService: ModelRepository;
  crmNoteService: ModelRepository;
  crmTaskService: ModelRepository;
}

/** Build proxy repositories that forward to the CRM node at `baseUrl`. */
export function createCrmProxyRepositories(baseUrl: string, token?: string): CrmRepositories {
  const url = baseUrl.replace(/\/$/, "");
  const repo = (model: string) => new CrmProxyRepository(url, SEGMENT_BY_MODEL[model], token);
  return {
    crmCompanyService: repo("crm_company"),
    crmPersonService: repo("crm_person"),
    crmOpportunityService: repo("crm_opportunity"),
    crmNoteService: repo("crm_note"),
    crmTaskService: repo("crm_task"),
  };
}

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

import { CRM_MODEL_BY_SEGMENT } from "./crm-contracts";
import { serializeListOrder } from "./list-order";

/**
 * The `limit` sent when a caller asks for every row (`take: null`).
 *
 * Deliberately finite: an unbounded read of a collection that has grown past
 * this is a bug worth noticing, not one to paper over. Well above any expected
 * CRM collection size (230 contacts today).
 */
export const PROXY_LIST_ALL_LIMIT = 100_000;


/**
 * model -> URL segment, INVERTED from the contract's `CRM_MODEL_BY_SEGMENT`
 * rather than restated.
 *
 * This was a hand-maintained duplicate, and adding `crm_activity` to the
 * contract left it stale — the proxy quietly built `/crm/undefined`, which the
 * node answers with a 404 that reads like a missing route rather than a missing
 * map entry. Inverting the one map makes a new collection work everywhere the
 * moment the contract declares it.
 */
const SEGMENT_BY_MODEL: Record<string, string> = Object.fromEntries(
  Object.entries(CRM_MODEL_BY_SEGMENT).map(([segment, model]) => [model, segment])
);

const ERROR_TYPE: Record<string, string> = {
  not_found: MedusaError.Types.NOT_FOUND,
  invalid_data: MedusaError.Types.INVALID_DATA,
  not_unique: MedusaError.Types.INVALID_DATA,
  not_allowed: MedusaError.Types.NOT_ALLOWED,
};

/**
 * What each node URL has told us it understands, probed once per process.
 *
 * Cached as the PROMISE, not the result, so concurrent first requests share one
 * probe rather than each opening their own.
 */
const CAPABILITIES_BY_URL = new Map<string, Promise<Set<string>>>();

/** Exposed for tests, which must not inherit another case's probe. */
export const __resetCrmNodeCapabilities = () => CAPABILITIES_BY_URL.clear();

const probeCapabilities = async (
  baseUrl: string,
  token?: string
): Promise<Set<string>> => {
  try {
    const res = await fetch(`${baseUrl}/health`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    const data = await res.json().catch(() => ({}));
    const caps = Array.isArray(data?.capabilities) ? data.capabilities : [];
    return new Set(caps.map(String));
  } catch {
    /**
     * ⚠️ An unreachable /health means "assume nothing". The list call that
     * follows will fail on its own terms if the node is genuinely down; what
     * must not happen is inferring a capability from a failed probe and then
     * sending a param that turns into a filter.
     */
    return new Set<string>();
  }
};

class CrmProxyRepository implements ModelRepository {
  /** Resolved by `ensureCapabilities` before any list that wants ordering. */
  private orderSupported = false;

  constructor(
    private baseUrl: string,
    private segment: string,
    private token?: string
  ) {}

  private async ensureCapabilities(): Promise<void> {
    let probe = CAPABILITIES_BY_URL.get(this.baseUrl);
    if (!probe) {
      probe = probeCapabilities(this.baseUrl, this.token);
      CAPABILITIES_BY_URL.set(this.baseUrl, probe);
    }
    this.orderSupported = (await probe).has("order");
  }

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

  private qs(
    filters?: Record<string, any>,
    config?: { take?: number | null; skip?: number; order?: Record<string, string> | null }
  ): string {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filters ?? {})) {
      if (v === undefined || v === null || typeof v === "object") continue; // node handles equality filters
      p.set(k, String(v));
    }
    if (config?.take === null) {
      // `take: null` means "every row" in the embedded repository. It used to be
      // dropped here, and the node then saw no `limit` at all -> `take:
      // undefined` -> the repository's DEFAULT PAGE OF 15. So the same call
      // returned everything in dev and the oldest fifteen rows in prod, with no
      // error either way. That silently truncates any full-collection read —
      // deriving a contact's engagement from its first 15 activities, or
      // building a dedupe map from 15 of 230 contacts.
      //
      // Sent as a large explicit number rather than a new sentinel so it
      // behaves identically on a node that has NOT been redeployed. (`limit=0`
      // would be worse than the bug: the old node reads it as take:0 and
      // returns an empty array.)
      p.set("limit", String(PROXY_LIST_ALL_LIMIT));
    } else if (config?.take != null) {
      p.set("limit", String(config.take));
    }
    if (config?.skip) p.set("offset", String(config.skip));
    /**
     * Ordering (#1551). `ListConfig` has always declared `order`, so the
     * EMBEDDED repository honoured it and the proxied one silently did not — a
     * fix that touched only the route would have worked in dev and done nothing
     * in prod, with no error either way. That is the same shape as the
     * `take: null` defect documented above.
     *
     * 🔴 Sent only when the node has said it understands it. Every param this
     * node does not recognise becomes an equality FILTER, so an `order` reaching
     * an un-redeployed node would filter on a column that does not exist and
     * return an EMPTY list — strictly worse than the unsorted one we have now.
     * `supportsOrder` is resolved from `/health` and cached per node URL.
     */
    const order = serializeListOrder(config?.order as any);
    if (order && this.orderSupported) p.set("order", order);
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
    // Only when ordering is actually asked for — an unsorted list costs no probe.
    if (config?.order) await this.ensureCapabilities();
    const { rows } = await this.call("GET", `/crm/${this.segment}${this.qs(filters, config)}`);
    return rows ?? [];
  }
  async listAndCount(filters: any = {}, config: any = {}): Promise<[any[], number]> {
    if (config?.order) await this.ensureCapabilities();
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
  crmActivityService: ModelRepository;
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
    crmActivityService: repo("crm_activity"),
  };
}

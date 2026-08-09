import { MedusaError, MedusaService } from "@medusajs/framework/utils"

import ProductionRunPolicy from "./models/production-run-policy"

import { InferTypeOf } from "@medusajs/framework/types"
import  ProductionRun from "../../modules/production_runs/models/production-run"
export type ProductionRun = InferTypeOf<typeof ProductionRun>

type ProductionRunLike = {
  id: string
  status?: string | null
  partner_id?: string | null
  role?: string | null
  depends_on_run_ids?: string[] | null
  dispatch_state?: string | null
  accepted_at?: Date | string | null
  started_at?: Date | string | null
  finished_at?: Date | string | null
  metadata?: Record<string, any> | null
}

/** #1228 — what the reminder cap does before parking a run for reassignment. */
export type ReassignmentPolicy = {
  /**
   * How many times the cap re-nudges the SAME partner (resetting the reminder
   * cycle) before the run is parked in `awaiting_reassignment`. 0 restores the
   * original #1093 behaviour: cap → park immediately.
   */
  same_partner_retries: number
  /**
   * On a same-partner retry ONLY, accept the run on the partner's behalf so
   * production can move without another round-trip. Gated a second time by the
   * partner's own `auto_accept_production_runs` opt-in — both must be true.
   */
  auto_accept_on_retry: boolean
}

export const DEFAULT_REASSIGNMENT_POLICY: ReassignmentPolicy = {
  same_partner_retries: 1,
  auto_accept_on_retry: false,
}

type StoredPolicy = {
  id: string
  key: string
  config: Record<string, any> | null
  metadata?: Record<string, any> | null
}

const DEFAULT_POLICY_KEY = "default"

/** Statuses no transition may leave. */
export const TERMINAL_RUN_STATUSES = ["completed", "cancelled"] as const

class ProductionPolicyService extends MedusaService({
  ProductionRunPolicy,
}) {
  constructor() {
    super(...arguments)
  }

  private getDispatchState(run: ProductionRun): string | null {
    return (run as any)?.dispatch_state ? String((run as any).dispatch_state) : null
  }

  private defaultPolicyConfig(): Record<string, any> {
    return {
      transitions: {
        approve_from: ["draft", "pending_review"],
        dispatch_from: ["approved"],
        send_to_production_from: ["approved"],
        accept_from: ["sent_to_partner"],
        // Partner work lifecycle. Accepting moves the run to in_progress;
        // start/finish/complete then stage within it via the lifecycle
        // timestamps (started_at / finished_at).
        start_work_from: ["in_progress"],
        finish_work_from: ["in_progress"],
        complete_work_from: ["in_progress"],
        decline_from: ["draft", "pending_review", "approved", "sent_to_partner", "in_progress"],
        // #1228 — manual (re)assignment. Deliberately a SEPARATE key from
        // dispatch_from: `allowedStatuses` falls back per-key, so adding this
        // takes effect on already-stored policy configs without a backfill,
        // whereas widening dispatch_from would need one.
        assign_partner_from: [
          "awaiting_reassignment",
          "draft",
          "pending_review",
          "approved",
          "sent_to_partner",
        ],
      },
      reassignment: DEFAULT_REASSIGNMENT_POLICY,
    }
  }

  /**
   * #1228 — what the reminder cap does before giving up on a partner.
   * Missing/partial stored config falls back field-by-field, same contract as
   * `allowedStatuses`, so existing policy rows need no backfill.
   */
  async getReassignmentPolicy(): Promise<ReassignmentPolicy> {
    const config = await this.getPolicyConfig()
    const stored = (config?.reassignment || {}) as Record<string, any>

    const retries = Number(stored.same_partner_retries)
    return {
      same_partner_retries: Number.isFinite(retries) && retries >= 0
        ? Math.floor(retries)
        : DEFAULT_REASSIGNMENT_POLICY.same_partner_retries,
      auto_accept_on_retry:
        typeof stored.auto_accept_on_retry === "boolean"
          ? stored.auto_accept_on_retry
          : DEFAULT_REASSIGNMENT_POLICY.auto_accept_on_retry,
    }
  }

  /**
   * #1228 — an admin is pointing the run at a partner by hand: the recovery
   * path out of `awaiting_reassignment`, and equally a correction before the
   * partner has accepted. Refuses once work is under way (in_progress) or the
   * run is terminal — swapping the partner mid-production would strand tasks.
   */
  async assertCanAssignPartner(run: ProductionRunLike) {
    if (!run) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "ProductionRun not found")
    }
    this.assertNotTerminal(run, "reassigned")

    const config = await this.getPolicyConfig()
    const allowed = this.allowedStatuses(config, "assign_partner_from", [
      "awaiting_reassignment",
      "draft",
      "pending_review",
      "approved",
      "sent_to_partner",
    ])

    const status = String(run.status)
    if (!allowed.includes(status)) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `ProductionRun ${run.id} cannot be assigned a partner from status ${status}`
      )
    }

    if (run.accepted_at) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `ProductionRun ${run.id} has already been accepted — cancel it instead of reassigning`
      )
    }
  }

  isTerminal(status: string | null | undefined): boolean {
    return TERMINAL_RUN_STATUSES.includes(String(status) as any)
  }

  /**
   * Defence-in-depth: nothing transitions out of a terminal run. Gives a
   * clearer error than the per-action allowed-status message.
   */
  private assertNotTerminal(run: ProductionRunLike, action: string) {
    const status = String(run.status)
    if (this.isTerminal(status)) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `ProductionRun ${run.id} is ${status} — it cannot be ${action}`
      )
    }
  }

  private allowedStatuses(config: Record<string, any>, key: string, fallback: string[]) {
    const transitions = (config?.transitions || {}) as Record<string, any>
    const v = transitions?.[key]
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
      return v as string[]
    }
    return fallback
  }

  async getOrCreatePolicy(): Promise<StoredPolicy> {
    const existing = await this.listProductionRunPolicies({
      key: DEFAULT_POLICY_KEY,
    } as any)

    const current = (existing || [])[0] as any
    if (current) {
      return current
    }

    const created = await this.createProductionRunPolicies({
      key: DEFAULT_POLICY_KEY,
      config: this.defaultPolicyConfig(),
      metadata: null,
    } as any)

    return created as any
  }

  async updatePolicy(input: { config: Record<string, any> | null }): Promise<StoredPolicy> {
    const policy = await this.getOrCreatePolicy()

    const updated = await this.updateProductionRunPolicies({
      id: policy.id,
      config: input.config,
    } as any)

    return updated as any
  }

  async getPolicyConfig(): Promise<Record<string, any>> {
    const policy = await this.getOrCreatePolicy()
    return (policy?.config || this.defaultPolicyConfig()) as Record<string, any>
  }

  async assertCanAccept(run: ProductionRun) {
    if (!run) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "ProductionRun not found")
    }

    if (!run.partner_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `ProductionRun ${run.id} must have partner_id to accept`
      )
    }

    const config = await this.getPolicyConfig()
    const allowed = this.allowedStatuses(config, "accept_from", ["sent_to_partner"])

    const status = String(run.status)
    if (!allowed.includes(status)) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `ProductionRun ${run.id} cannot be accepted from status ${status}`
      )
    }
  }

  async assertCanApprove(run: ProductionRunLike) {
    if (!run) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "ProductionRun not found")
    }

    const config = await this.getPolicyConfig()
    const allowed = this.allowedStatuses(config, "approve_from", [
      "draft",
      "pending_review",
    ])

    const status = String(run.status)
    if (!allowed.includes(status)) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `ProductionRun ${run.id} cannot be approved from status ${status}`
      )
    }
  }

  async assertCanStartDispatch(run: ProductionRun) {
    if (!run) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "ProductionRun not found")
    }

    if (!run.partner_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `ProductionRun ${run.id} must have partner_id to dispatch`
      )
    }

    const config = await this.getPolicyConfig()
    const allowed = this.allowedStatuses(config, "dispatch_from", ["approved"])

    const status = String(run.status)
    if (!allowed.includes(status)) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `ProductionRun ${run.id} must be approved before dispatch. Current status: ${status}`
      )
    }

    const dispatchState = this.getDispatchState(run)
    if (dispatchState === "awaiting_templates") {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `ProductionRun ${run.id} dispatch is already awaiting template selection`
      )
    }
  }

  async assertCanSendToProduction(run: ProductionRunLike) {
    if (!run) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "ProductionRun not found")
    }

    if (!run.partner_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `ProductionRun ${run.id} must have partner_id to send to production`
      )
    }

    const config = await this.getPolicyConfig()
    const allowed = this.allowedStatuses(config, "send_to_production_from", ["approved"])

    const status = String(run.status)
    if (!allowed.includes(status)) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `ProductionRun ${run.id} must be approved before sending. Current status: ${status}`
      )
    }
  }

  // ── Partner work lifecycle ────────────────────────────────────────────

  async assertCanStartWork(run: ProductionRunLike) {
    if (!run) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "ProductionRun not found")
    }
    this.assertNotTerminal(run, "started")

    const config = await this.getPolicyConfig()
    const allowed = this.allowedStatuses(config, "start_work_from", ["in_progress"])
    const status = String(run.status)
    if (!allowed.includes(status)) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Production run must be ${allowed.join(" or ")} to start. Current status: ${status}`
      )
    }

    if (run.started_at) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Production run has already been started"
      )
    }
  }

  async assertCanFinishWork(run: ProductionRunLike) {
    if (!run) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "ProductionRun not found")
    }
    this.assertNotTerminal(run, "finished")

    const config = await this.getPolicyConfig()
    const allowed = this.allowedStatuses(config, "finish_work_from", ["in_progress"])
    const status = String(run.status)
    if (!allowed.includes(status)) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Production run must be ${allowed.join(" or ")} to finish. Current status: ${status}`
      )
    }

    if (!run.started_at) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Production run must be started before it can be finished"
      )
    }
  }

  async assertCanCompleteWork(run: ProductionRunLike) {
    if (!run) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "ProductionRun not found")
    }
    this.assertNotTerminal(run, "completed")

    const config = await this.getPolicyConfig()
    const allowed = this.allowedStatuses(config, "complete_work_from", ["in_progress"])
    const status = String(run.status)
    if (!allowed.includes(status)) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Production run must be ${allowed.join(" or ")} to complete. Current status: ${status}`
      )
    }

    if (!run.finished_at) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Production run must be finished before it can be completed"
      )
    }
  }

  /**
   * Partner decline — only before real work begins. Mid-flight
   * cancellation stays admin-only. The idempotent already-cancelled
   * path is the route's concern (it returns 200, not an error).
   */
  async assertCanDecline(run: ProductionRunLike) {
    if (!run) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "ProductionRun not found")
    }
    if (String(run.status) === "completed") {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Cannot decline a completed production run"
      )
    }

    const config = await this.getPolicyConfig()
    const allowed = this.allowedStatuses(config, "decline_from", [
      "draft",
      "pending_review",
      "approved",
      "sent_to_partner",
      "in_progress",
    ])
    const status = String(run.status)
    if (!allowed.includes(status)) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Production run cannot be declined from status ${status}`
      )
    }

    if (run.started_at) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Work has already started on this run. Contact admin to cancel mid-production."
      )
    }
  }
}

export default ProductionPolicyService

import { MedusaError, MedusaService } from "@medusajs/framework/utils"

import ProductionRunPolicy from "./models/production-run-policy"

type ProductionRunLike = {
  id: string
  status?: string | null
  partner_id?: string | null
  role?: string | null
  metadata?: Record<string, any> | null
}

type StoredPolicy = {
  id: string
  key: string
  config: Record<string, any> | null
  metadata?: Record<string, any> | null
}

const DEFAULT_POLICY_KEY = "default"

class ProductionPolicyService extends MedusaService({
  ProductionRunPolicy,
}) {
  constructor() {
    super(...arguments)
  }

  private getDispatchState(run: ProductionRunLike): string | null {
    const metadata = (run?.metadata || {}) as Record<string, any>
    const dispatch = (metadata.dispatch || {}) as Record<string, any>
    return dispatch.state ? String(dispatch.state) : null
  }

  private defaultPolicyConfig(): Record<string, any> {
    return {
      transitions: {
        approve_from: ["draft", "pending_review"],
        dispatch_from: ["approved"],
        send_to_production_from: ["approved"],
        accept_from: ["sent_to_partner"],
      },
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

  async assertCanAccept(run: ProductionRunLike) {
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

  async assertCanStartDispatch(run: ProductionRunLike) {
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
}

export default ProductionPolicyService

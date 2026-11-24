/**
 * #2596 — a partner's rate estimates, per technique.
 *
 * Create / update / delete, each tenant-guarded (a rate id that belongs to
 * another partner 404s) and each keeping the index link in step with the row.
 */
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"

import { PARTNER_CAPABILITY_MODULE } from "../../modules/partner_capability"
import { getTechnique, type RateUnit } from "../../modules/partner_capability/lib/techniques"
import { linkCapabilityRows, unlinkCapabilityRows } from "./capability-index-links"
import { assertPartnerExistsStep } from "./steps/assert-partner-exists"

export type CapabilityRateFields = {
  technique?: string
  sample_id?: string | null
  unit?: RateUnit
  min_qty?: number | null
  max_qty?: number | null
  currency_code?: string
  price_low?: number
  price_high?: number | null
  setup_fee?: number | null
  lead_days?: number | null
  tax_basis?: "gst_exclusive" | "gst_inclusive" | "unknown"
  source?: "partner_quoted" | "admin_estimate" | "from_past_runs"
  status?: "proposed" | "confirmed"
  observed_at?: Date | null
  notes?: string | null
}

/** Business rules shared by create and update, on the MERGED row. */
const assertRateIsCoherent = (row: CapabilityRateFields) => {
  if (!getTechnique(row.technique)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Unknown technique "${row.technique}". Use a slug from GET /admin/capabilities/techniques.`
    )
  }
  if (row.price_low == null || Number(row.price_low) < 0) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "price_low must be 0 or more")
  }
  if (row.price_high != null && Number(row.price_high) < Number(row.price_low)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "price_high is below price_low")
  }
  if (row.min_qty != null && row.max_qty != null && row.max_qty < row.min_qty) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "max_qty is below min_qty")
  }
}

const findOwnedRate = async (service: any, partnerId: string, rateId: string) => {
  const [row] = await service.listPartnerCapabilityRates({ id: rateId, partner_id: partnerId })
  if (!row) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `capability rate ${rateId} does not belong to partner ${partnerId}`
    )
  }
  return row
}

const assertSampleOwned = async (service: any, partnerId: string, sampleId?: string | null) => {
  if (!sampleId) return
  const [s] = await service.listPartnerCapabilitySamples({ id: sampleId, partner_id: partnerId })
  if (!s) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `capability sample ${sampleId} does not belong to partner ${partnerId}`
    )
  }
}

// ── create ──────────────────────────────────────────────────────────────

export type CreateCapabilityRateInput = CapabilityRateFields & {
  partner_id: string
  technique: string
  price_low: number
}

const createCapabilityRateStep = createStep(
  "create-capability-rate-step",
  async (input: CreateCapabilityRateInput, { container }) => {
    const service: any = container.resolve(PARTNER_CAPABILITY_MODULE)
    assertRateIsCoherent(input)
    await assertSampleOwned(service, input.partner_id, input.sample_id)

    const rate = await service.createPartnerCapabilityRates({
      ...input,
      unit: input.unit ?? getTechnique(input.technique)!.default_unit,
      // A rate worked out from past runs is a proposal until a person agrees.
      status: input.status ?? (input.source === "from_past_runs" ? "proposed" : "confirmed"),
      observed_at: input.observed_at ?? new Date(),
    })
    await linkCapabilityRows(container, input.partner_id, "rate", [rate.id])
    return new StepResponse({ rate }, { id: rate.id, partner_id: input.partner_id })
  },
  async (comp: { id: string; partner_id: string } | undefined, { container }) => {
    if (!comp) return
    const service: any = container.resolve(PARTNER_CAPABILITY_MODULE)
    await unlinkCapabilityRows(container, comp.partner_id, "rate", [comp.id])
    await service.deletePartnerCapabilityRates(comp.id)
  }
)

export const createCapabilityRateWorkflow = createWorkflow(
  "create-capability-rate",
  function (input: CreateCapabilityRateInput) {
    assertPartnerExistsStep({ partner_id: input.partner_id })
    return new WorkflowResponse(createCapabilityRateStep(input))
  }
)

// ── update ──────────────────────────────────────────────────────────────

export type UpdateCapabilityRateInput = CapabilityRateFields & {
  partner_id: string
  rate_id: string
}

const updateCapabilityRateStep = createStep(
  "update-capability-rate-step",
  async (input: UpdateCapabilityRateInput, { container }) => {
    const service: any = container.resolve(PARTNER_CAPABILITY_MODULE)
    const before = await findOwnedRate(service, input.partner_id, input.rate_id)
    const { partner_id, rate_id, ...patch } = input
    const merged = { ...before, ...patch }
    assertRateIsCoherent(merged)
    await assertSampleOwned(service, partner_id, patch.sample_id)

    const rate = await service.updatePartnerCapabilityRates({ id: rate_id, ...patch })
    return new StepResponse({ rate }, { before })
  },
  async (comp: { before: any } | undefined, { container }) => {
    if (!comp) return
    const service: any = container.resolve(PARTNER_CAPABILITY_MODULE)
    const { created_at, updated_at, deleted_at, raw_price_low, raw_price_high, raw_setup_fee, ...restore } = comp.before
    await service.updatePartnerCapabilityRates(restore)
  }
)

export const updateCapabilityRateWorkflow = createWorkflow(
  "update-capability-rate",
  function (input: UpdateCapabilityRateInput) {
    return new WorkflowResponse(updateCapabilityRateStep(input))
  }
)

// ── delete ──────────────────────────────────────────────────────────────

const deleteCapabilityRateStep = createStep(
  "delete-capability-rate-step",
  async (input: { partner_id: string; rate_id: string }, { container }) => {
    const service: any = container.resolve(PARTNER_CAPABILITY_MODULE)
    await findOwnedRate(service, input.partner_id, input.rate_id)
    await unlinkCapabilityRows(container, input.partner_id, "rate", [input.rate_id])
    await service.softDeletePartnerCapabilityRates(input.rate_id)
    return new StepResponse({ id: input.rate_id, deleted: true }, input)
  },
  async (comp: { partner_id: string; rate_id: string } | undefined, { container }) => {
    if (!comp) return
    const service: any = container.resolve(PARTNER_CAPABILITY_MODULE)
    await service.restorePartnerCapabilityRates(comp.rate_id)
    await linkCapabilityRows(container, comp.partner_id, "rate", [comp.rate_id])
  }
)

export const deleteCapabilityRateWorkflow = createWorkflow(
  "delete-capability-rate",
  function (input: { partner_id: string; rate_id: string }) {
    return new WorkflowResponse(deleteCapabilityRateStep(input))
  }
)

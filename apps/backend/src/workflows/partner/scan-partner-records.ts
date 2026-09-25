/**
 * Scan OUR records of a partner into capability PROPOSALS (#2249).
 *
 * Same contract as the website scan: reads, proposes, stores a
 * `partner_capability_scan` row (kind `records`), files nothing. The commit is
 * the shared commit-partner-capability-scan workflow, which stamps rows
 * `source: "records"` — the strongest evidence the library can hold, because
 * the run, the order and the product are OURS.
 */
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import type { ScanProposal, ScannedCatalogue } from "../../lib/website-scan/types"
import { PARTNER_CAPABILITY_MODULE } from "../../modules/partner_capability"
import { readPartnerRecords } from "./lib/read-partner-records"
import { proposeFromCatalogue } from "./scan-partner-website"
import { assertPartnerExistsStep } from "./steps/assert-partner-exists"

export type ScanPartnerRecordsWorkflowInput = { partner_id: string }

const readRecordsStep = createStep(
  "scan-partner-records-read-step",
  async (input: ScanPartnerRecordsWorkflowInput, { container }) => {
    const catalogue = await readPartnerRecords(container, input.partner_id)
    const proposal = await proposeFromCatalogue(container, catalogue)
    return new StepResponse({ catalogue, proposal })
  }
)

const storeRecordsScanStep = createStep(
  "scan-partner-records-store-step",
  async (
    input: { partner_id: string; catalogue: ScannedCatalogue; proposal: ScanProposal },
    { container }
  ) => {
    const service: any = container.resolve(PARTNER_CAPABILITY_MODULE)
    const scan = await service.createPartnerCapabilityScans({
      partner_id: input.partner_id,
      kind: "records",
      url: null,
      origin: null,
      platform: "records",
      status: "proposed",
      proposal: input.proposal,
    })
    return new StepResponse(scan, scan.id)
  },
  async (scanId: string | undefined, { container }) => {
    if (!scanId) return
    const service: any = container.resolve(PARTNER_CAPABILITY_MODULE)
    await service.deletePartnerCapabilityScans(scanId)
  }
)

export const scanPartnerRecordsWorkflow = createWorkflow(
  "scan-partner-records",
  (input: ScanPartnerRecordsWorkflowInput) => {
    assertPartnerExistsStep({ partner_id: input.partner_id })
    const read = readRecordsStep(input)
    const scan = storeRecordsScanStep({
      partner_id: input.partner_id,
      catalogue: read.catalogue,
      proposal: read.proposal,
    })
    return new WorkflowResponse(scan)
  }
)

export default scanPartnerRecordsWorkflow

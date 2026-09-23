/**
 * Scan a partner's website into capability PROPOSALS (#2249).
 *
 * Writes nothing to the capability library. It reads the site, asks a model to
 * group what it found, and stores the result as a `partner_capability_scan` row —
 * so an operator looks before anything lands on the partner, and the commit
 * acts on what the SITE said rather than on a proposal handed back by a caller.
 */
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"
import { generateText } from "ai"

import { resolveRoleTextModel } from "../../mastra/services/ai-platforms"
import { readModelJson } from "../../lib/ai/model-json"
import { typeSafeConfigured } from "../../lib/ai/typesafe"
import { classifyEvidence, proposalFromClasses } from "../../lib/website-scan/classify-evidence"
import { readPartnerCatalogue } from "../../lib/website-scan/read-catalogue"
import {
  buildScanPrompt,
  fallbackProposal,
  modelAnswerSchema,
  proposalFromModel,
  SCAN_SYSTEM_PROMPT,
} from "../../lib/website-scan/propose"
import type { ScanProposal, ScannedCatalogue } from "../../lib/website-scan/types"
import { UnsafeUrlError } from "../../lib/website-scan/safe-fetch"
import { PARTNER_CAPABILITY_MODULE } from "../../modules/partner_capability"
import { assertPartnerExistsStep } from "./steps/assert-partner-exists"

export const WEBSITE_SCAN_ROLE = "ai_partner_website_scan"
/**
 * The WHOLE model budget, retries included. The scan runs inside an HTTP
 * request behind a load balancer that answers 504 at ~60s; with the SDK's
 * default 3 attempts against a rate-limited free model, 11 of 14 paced scans
 * crossed it (prod, 2026-09-24). One retry inside 25s keeps the request under
 * the gateway and still falls back cleanly.
 */
const MODEL_TIMEOUT_MS = 25_000
const MODEL_MAX_RETRIES = 1

export type ScanPartnerWebsiteWorkflowInput = {
  partner_id: string
  url: string
}

/**
 * The model call, isolated so it can fail without failing the scan. Set
 * WEBSITE_SCAN_MODEL=off to skip it (ops kill-switch; also what the HTTP
 * integration test uses, since it must not depend on a live provider).
 */
export const proposeFromCatalogue = async (
  container: any,
  catalogue: ScannedCatalogue
): Promise<ScanProposal> => {
  if (!catalogue.products.length) {
    return fallbackProposal(catalogue, "the site lists no products")
  }
  if (process.env.WEBSITE_SCAN_MODEL === "off") {
    return fallbackProposal(catalogue, "the model is switched off")
  }
  // TypeSafe first: three closed choices per item, answered as typed data in
  // ~1.5s, grouped in code. When it is configured and fails, the scan falls
  // back mechanically and SAYS so — it does not quietly try a slower model.
  if (typeSafeConfigured()) {
    let logger: any
    try {
      logger = container.resolve("logger")
    } catch {
      /* optional */
    }
    const classes = await classifyEvidence(catalogue.products, logger)
    return classes
      ? proposalFromClasses(catalogue, classes)
      : fallbackProposal(catalogue, "TypeSafe did not answer")
  }
  // One attempt. With no platform configured for this role the free-model
  // rotator answers, and some of its pool refuse outright ("only available on
  // agentic harnesses"); a retry was tried and hit the SAME model, so the fix is
  // tagging a platform with this role, not retrying.
  try {
    const resolved = await resolveRoleTextModel(container, WEBSITE_SCAN_ROLE)
    const response = await generateText({
      model: resolved.model as any,
      system: SCAN_SYSTEM_PROMPT,
      prompt: buildScanPrompt(catalogue),
      maxRetries: MODEL_MAX_RETRIES,
      abortSignal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    })
    const raw = readModelJson(response as any)
    const parsed = raw ? modelAnswerSchema.safeParse(raw) : null
    if (!parsed?.success) {
      return fallbackProposal(catalogue, "the model's answer was not usable JSON")
    }
    const proposal = proposalFromModel(catalogue, parsed.data)
    // A model that grouped nothing is a blind read, not "they make nothing".
    return proposal.samples.length
      ? proposal
      : fallbackProposal(catalogue, "the model proposed no evidenced capability")
  } catch (e: any) {
    return fallbackProposal(catalogue, `the model call failed: ${e?.message ?? e}`)
  }
}

const readAndProposeStep = createStep(
  "scan-partner-website-read-step",
  async (input: ScanPartnerWebsiteWorkflowInput, { container }) => {
    let catalogue: ScannedCatalogue
    try {
      catalogue = await readPartnerCatalogue(input.url)
    } catch (e: any) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        e instanceof UnsafeUrlError || e?.name === "UnsafeUrlError"
          ? `Cannot scan this URL: ${e.message}`
          : `Could not read ${input.url}: ${e?.message ?? e}`
      )
    }
    const proposal = await proposeFromCatalogue(container, catalogue)
    return new StepResponse({ catalogue, proposal })
  }
)

const storeScanStep = createStep(
  "scan-partner-website-store-step",
  async (
    input: {
      partner_id: string
      url: string
      catalogue: ScannedCatalogue
      proposal: ScanProposal
    },
    { container }
  ) => {
    const service: any = container.resolve(PARTNER_CAPABILITY_MODULE)
    const scan = await service.createPartnerCapabilityScans({
      partner_id: input.partner_id,
      kind: "website",
      url: input.url,
      origin: input.catalogue.origin,
      platform: input.catalogue.platform,
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

export const scanPartnerWebsiteWorkflow = createWorkflow(
  "scan-partner-website",
  (input: ScanPartnerWebsiteWorkflowInput) => {
    assertPartnerExistsStep({ partner_id: input.partner_id })
    const read = readAndProposeStep(input)
    const scan = storeScanStep({
      partner_id: input.partner_id,
      url: input.url,
      catalogue: read.catalogue,
      proposal: read.proposal,
    })
    return new WorkflowResponse(scan)
  }
)

export default scanPartnerWebsiteWorkflow

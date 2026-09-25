/**
 * Commit chosen proposals from a capability scan — a website or our own
 * records — into the capability library (#2249).
 *
 * Only what the stored scan proposed can be committed — the caller picks KEYS,
 * it cannot supply content — so every `website`/`records` row is something
 * that source actually said. A website's photos are copied into our media
 * (the partner's capability folder) through the same SSRF guard as the scan:
 * the evidence must survive the partner redesigning their site. A records
 * scan's photos are ALREADY ours and are linked, not re-uploaded.
 *
 * Idempotent per key: `committed_keys` maps each proposal key to the row it
 * became, and a key already there is skipped, so a retry or a double-click
 * cannot file the same capability twice.
 */
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"

import { ensurePartnerCapabilityFolder } from "../../api/partners/capabilities/uploads/folder"
import { safeFetch } from "../../lib/website-scan/safe-fetch"
import type { ScanProposal } from "../../lib/website-scan/types"
import { MEDIA_MODULE } from "../../modules/media"
import { PARTNER_CAPABILITY_MODULE } from "../../modules/partner_capability"
import { normalizeCapabilityActions } from "../../modules/partner_capability/lib/actions"
import { uploadAndOrganizeMediaWorkflow } from "../media/upload-and-organize-media"
import { attachCapabilityMedia } from "./capability-media"
import { assertPartnerExistsStep } from "./steps/assert-partner-exists"

const MAX_IMAGE_BYTES = 8 * 1024 * 1024

export type CommitPartnerCapabilityScanWorkflowInput = {
  partner_id: string
  scan_id: string
  /** Proposal keys to commit. Omitted = every sample. */
  sample_keys?: string[]
  /** Omitted = every knowledge fact. */
  knowledge_keys?: string[]
}

type CommittedKeys = Record<string, string>

const filenameFor = (url: string, contentType: string, i: number) => {
  const base = decodeURIComponent(new URL(url).pathname.split("/").pop() || "")
    .replace(/[^\w.-]+/g, "-")
    .slice(-80)
  const ext = contentType.split("/")[1]?.split(";")[0] || "jpg"
  return base && /\.\w{2,5}$/.test(base) ? base : `website-${i}.${ext}`
}

/**
 * Download one photo into media. A photo that cannot be fetched is a WARNING,
 * not a failure: the capability is still evidenced by its source_url, and one
 * dead image should not block the rest of the commit.
 */
const copyImage = async (
  container: any,
  folderId: string,
  partnerId: string,
  imageUrl: string,
  i: number
): Promise<{ id: string | null; warning?: string }> => {
  // Already ours (a URL on our own storage)? Link the row, don't upload a copy.
  try {
    const media: any = container.resolve(MEDIA_MODULE)
    const [existing] = await media.listMediaFiles({ file_path: imageUrl }, { take: 1 })
    if (existing?.id) return { id: existing.id }
  } catch {
    /* fall through to copying */
  }
  try {
    const res = await safeFetch(imageUrl, {
      maxBytes: MAX_IMAGE_BYTES,
      accept: "image/*",
    })
    if (res.status !== 200) return { id: null, warning: `${imageUrl} answered ${res.status}` }
    const type = res.contentType.split(";")[0].trim().toLowerCase()
    if (!type.startsWith("image/")) {
      return { id: null, warning: `${imageUrl} is not an image (${type || "no type"})` }
    }
    const { result } = await uploadAndOrganizeMediaWorkflow(container).run({
      input: {
        // base64, NOT raw bytes — the S3 provider sniffs base64 (whatsapp-media-helper).
        files: [{ filename: filenameFor(res.url, type, i), mimeType: type, content: res.body.toString("base64") }],
        existingFolderId: folderId,
        metadata: { source: "partner_capability_scan", partner_id: partnerId, source_url: res.url },
      },
    })
    const id = (result as any)?.mediaFiles?.[0]?.id ?? null
    return id ? { id } : { id: null, warning: `${imageUrl} uploaded but produced no media row` }
  } catch (e: any) {
    return { id: null, warning: `${imageUrl}: ${e?.message ?? e}` }
  }
}

const loadScanStep = createStep(
  "commit-capability-scan-load-step",
  async (input: CommitPartnerCapabilityScanWorkflowInput, { container }) => {
    const service: any = container.resolve(PARTNER_CAPABILITY_MODULE)
    const [scan] = await service.listPartnerCapabilityScans({ id: input.scan_id })
    // Another partner's scan is a 404, not a cross-tenant write.
    if (!scan || scan.partner_id !== input.partner_id) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "Capability scan not found for this partner")
    }
    const proposal = scan.proposal as ScanProposal
    const known = new Set([
      ...proposal.samples.map((s) => s.key),
      ...proposal.knowledge.map((k) => k.key),
    ])
    const unknown = [...(input.sample_keys ?? []), ...(input.knowledge_keys ?? [])].filter(
      (k) => !known.has(k)
    )
    if (unknown.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `This scan proposed no ${unknown.join(", ")}`
      )
    }
    return new StepResponse(scan)
  }
)

const commitProposalsStep = createStep(
  "commit-capability-scan-write-step",
  async (
    input: CommitPartnerCapabilityScanWorkflowInput & { scan: any; partner: { id: string; name?: string } },
    { container }
  ) => {
    const service: any = container.resolve(PARTNER_CAPABILITY_MODULE)
    const proposal = input.scan.proposal as ScanProposal
    const previous: CommittedKeys = { ...(input.scan.committed_keys ?? {}) }
    const scannedAt = new Date(input.scan.created_at ?? Date.now())
    const source: "website" | "records" = input.scan.kind === "records" ? "records" : "website"

    const wantSamples = input.sample_keys ? new Set(input.sample_keys) : null
    const wantKnowledge = input.knowledge_keys ? new Set(input.knowledge_keys) : null
    const samplesToWrite = proposal.samples.filter(
      (s) => (!wantSamples || wantSamples.has(s.key)) && !previous[s.key]
    )
    const knowledgeToWrite = proposal.knowledge.filter(
      (k) => (!wantKnowledge || wantKnowledge.has(k.key)) && !previous[k.key]
    )

    const created = { samples: [] as any[], knowledge: [] as any[] }
    const warnings: string[] = []
    const keys: CommittedKeys = { ...previous }

    const folderId = samplesToWrite.some((s) => s.image_urls.length)
      ? await ensurePartnerCapabilityFolder(container, input.partner)
      : null

    try {
      for (const s of samplesToWrite) {
        // Rows a records scan already resolved come first, as-is.
        const mediaIds: string[] = [...(s.media_file_ids ?? [])]
        for (const [i, url] of s.image_urls.entries()) {
          const copied = await copyImage(container, folderId!, input.partner_id, url, i)
          if (copied.id) mediaIds.push(copied.id)
          if (copied.warning) warnings.push(`${s.title}: ${copied.warning}`)
        }
        const sample = await service.createPartnerCapabilitySamples({
          partner_id: input.partner_id,
          title: s.title,
          product_type: s.product_type,
          technique: s.technique,
          material: s.material,
          actions: normalizeCapabilityActions(s.actions),
          notes: s.notes,
          media_file_ids: mediaIds.length ? [...new Set(mediaIds)] : null,
          source,
          source_url: s.source_url ?? input.scan.origin ?? null,
          // The site's publish date when it gave one; otherwise the scan date,
          // and the row SAYS it was defaulted rather than looking fresh.
          captured_at: s.captured_at ? new Date(s.captured_at) : scannedAt,
          metadata: {
            capability_scan_id: input.scan.id,
            proposal_key: s.key,
            captured_at_defaulted: !s.captured_at,
            evidence: s.evidence,
          },
        })
        created.samples.push(sample)
        keys[s.key] = sample.id
      }

      for (const k of knowledgeToWrite) {
        const row = await service.createPartnerCapabilityKnowledges({
          partner_id: input.partner_id,
          sample_id: k.sample_key ? (keys[k.sample_key] ?? null) : null,
          fact: k.fact,
          source,
          source_url: k.source_url ?? input.scan.origin ?? null,
          observed_at: scannedAt,
          metadata: { capability_scan_id: input.scan.id, proposal_key: k.key },
        })
        created.knowledge.push(row)
        keys[k.key] = row.id
      }
    } catch (e) {
      // Undo this call's rows before failing; the compensation below only runs
      // for a LATER step's failure.
      if (created.samples.length) await service.deletePartnerCapabilitySamples(created.samples.map((r) => r.id))
      if (created.knowledge.length) await service.deletePartnerCapabilityKnowledges(created.knowledge.map((r) => r.id))
      throw e
    }

    await service.updatePartnerCapabilityScans({
      id: input.scan.id,
      status: "committed",
      committed_at: new Date(),
      committed_keys: keys,
    })

    return new StepResponse(
      {
        samples: await attachCapabilityMedia(container, created.samples),
        knowledge: created.knowledge,
        skipped_already_committed: [
          ...proposal.samples.filter((s) => previous[s.key] && (!wantSamples || wantSamples.has(s.key))).map((s) => s.key),
          ...proposal.knowledge.filter((k) => previous[k.key] && (!wantKnowledge || wantKnowledge.has(k.key))).map((k) => k.key),
        ],
        warnings,
      },
      {
        scan_id: input.scan.id,
        previous_keys: input.scan.committed_keys ?? null,
        previous_status: input.scan.status,
        previous_committed_at: input.scan.committed_at ?? null,
        sample_ids: created.samples.map((r) => r.id),
        knowledge_ids: created.knowledge.map((r) => r.id),
      }
    )
  },
  async (comp: any, { container }) => {
    if (!comp) return
    const service: any = container.resolve(PARTNER_CAPABILITY_MODULE)
    if (comp.sample_ids?.length) await service.deletePartnerCapabilitySamples(comp.sample_ids)
    if (comp.knowledge_ids?.length) await service.deletePartnerCapabilityKnowledges(comp.knowledge_ids)
    await service.updatePartnerCapabilityScans({
      id: comp.scan_id,
      status: comp.previous_status,
      committed_at: comp.previous_committed_at,
      committed_keys: comp.previous_keys,
    })
  }
)

export const commitPartnerCapabilityScanWorkflow = createWorkflow(
  "commit-partner-capability-scan",
  (input: CommitPartnerCapabilityScanWorkflowInput) => {
    const partner = assertPartnerExistsStep({ partner_id: input.partner_id })
    const scan = loadScanStep(input)
    const result = commitProposalsStep({
      partner_id: input.partner_id,
      scan_id: input.scan_id,
      sample_keys: input.sample_keys,
      knowledge_keys: input.knowledge_keys,
      scan,
      partner,
    })
    return new WorkflowResponse(result)
  }
)

export default commitPartnerCapabilityScanWorkflow

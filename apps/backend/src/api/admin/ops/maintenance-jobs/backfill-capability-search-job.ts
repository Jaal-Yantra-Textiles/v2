import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { PARTNER_MODULE } from "../../../../modules/partner"
import { PARTNER_CAPABILITY_MODULE } from "../../../../modules/partner_capability"
import { normalizeTechnique, sampleTechniqueSlug } from "../../../../modules/partner_capability/lib/techniques"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * #2596 — make the capability samples that existed before the search was
 * built findable: map `technique` onto the vocabulary (`technique_slug`) and
 * write the partner ↔ sample link the index engine reads.
 *
 * Idempotent: a sample already linked / correctly mapped is left alone. A
 * technique that maps to nothing stays null and is listed, so the operator
 * can see which words the vocabulary is missing.
 *
 * Also CORRECTS a slug that contradicts what the partner did (#2606): a
 * stitch-only "Tangaliya cotton skirt" had handloom_weaving and made a
 * tailor look like a weaver. Such a slug is cleared, and says why.
 */
const paramsSchema = z.object({
  partner_id: z.string().min(1).optional(),
  limit: z.number().int().positive().max(5000).optional().default(1000),
})

export const backfillCapabilitySearchJob: MaintenanceJob = {
  id: "backfill-capability-search",
  label: "Make existing capability samples searchable",
  description:
    "For partner capability samples created before #2596: set technique_slug from the free-text technique (vocabulary match; unmatched words are reported, not guessed; a slug that contradicts the sample's actions — e.g. a stitch-only sample tagged weaving — is cleared) and create the missing partner ↔ sample link so the index-backed capability search and recipes find them. Already-done rows are skipped. Optionally scope to one partner_id.",
  params: [
    { name: "partner_id", type: "string", required: false, description: "Only this partner's samples" },
    { name: "limit", type: "number", required: false, description: "Max samples to scan (default 1000, max 5000)" },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = paramsSchema.safeParse(params ?? {})
    if (!parsed.success) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, parsed.error.issues.map((i) => i.message).join("; "))
    }
    const { partner_id, limit } = parsed.data
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const link: any = container.resolve(ContainerRegistrationKeys.LINK)
    const service: any = container.resolve(PARTNER_CAPABILITY_MODULE)

    const { data: samples } = await query.graph({
      entity: "partner_capability_sample",
      fields: ["id", "partner_id", "technique", "technique_slug", "actions", "partner.id"],
      filters: partner_id ? { partner_id } : {},
      pagination: { take: limit },
    })

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    const unmapped = new Map<string, number>()

    for (const s of samples as any[]) {
      try {
        const slug = sampleTechniqueSlug(s.technique, s.actions)
        const before = s.technique_slug ?? null
        if (slug !== before) {
          const note = slug
            ? `technique "${s.technique}"`
            : `technique "${s.technique}" is not what the partner did (actions: ${(s.actions ?? []).join(", ")})`
          changes.push({ entity: "partner_capability_sample", id: s.id, field: "technique_slug", before, after: slug, note })
          if (!dry_run) await service.updatePartnerCapabilitySamples({ id: s.id, technique_slug: slug })
        }
        if (s.technique && !normalizeTechnique(s.technique)) unmapped.set(s.technique, (unmapped.get(s.technique) ?? 0) + 1)

        if (!s.partner?.id) {
          changes.push({ entity: "partner_capability_sample", id: s.id, field: "partner_link", before: "missing", after: s.partner_id })
          if (!dry_run) {
            await link.create({
              [PARTNER_MODULE]: { partner_id: s.partner_id },
              [PARTNER_CAPABILITY_MODULE]: { partner_capability_sample_id: s.id },
            })
          }
        }
      } catch (e: any) {
        errors.push({ id: s.id, message: e?.message ?? String(e) })
      }
    }

    const verb = dry_run ? "Would change" : "Changed"
    const unmappedNote = unmapped.size
      ? `; techniques with no vocabulary match: ${[...unmapped].map(([t, n]) => `"${t}"×${n}`).join(", ")}`
      : ""
    return {
      job_id: backfillCapabilitySearchJob.id,
      dry_run,
      applied: !dry_run && changes.length > 0,
      summary: `${verb} ${changes.length} field(s) across ${(samples as any[]).length} sample(s) scanned${unmappedNote}` + (errors.length ? `; ${errors.length} error(s)` : ""),
      changes,
      ...(errors.length ? { errors } : {}),
    }
  },
}

export default backfillCapabilitySearchJob

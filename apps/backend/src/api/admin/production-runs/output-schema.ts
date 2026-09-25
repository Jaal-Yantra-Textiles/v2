import { z } from "@medusajs/framework/zod"

/**
 * #2271 — a run's output split per size/colour, as it arrives over HTTP.
 *
 * Shape only. Whether a size or colour is one the run is actually for, and
 * whether the lines add up, depends on the run's snapshot, so the workflow
 * checks that (`workflows/production-runs/lib/run-output.ts`).
 *
 * Shared by every door that creates or completes a run, because a strict
 * validator STRIPS an undeclared field: declaring it on one route and not the
 * next is how a field silently never arrives (see the `materials` and
 * `template_names` notes in the design-run validators).
 */
export const OutputLineSchema = z.object({
  size_label: z.string().trim().nullish(),
  color: z.string().trim().nullish(),
  quantity: z.number().min(0),
})

export const OutputLinesSchema = z.array(OutputLineSchema)

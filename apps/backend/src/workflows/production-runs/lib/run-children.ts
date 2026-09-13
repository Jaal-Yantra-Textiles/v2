import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { PRODUCTION_RUNS_MODULE } from "../../../modules/production_runs"

/**
 * The runs a split moved the work to — read from the schema, not from a blob.
 *
 * ## Why (#2029 item 1)
 *
 * When a run is approved and split, `dualWriteChildRunOrdersStep` cancels the
 * PARENT's unified order and stamps `metadata.superseded_by_run_ids` on it with
 * the child run ids. That blob is the only thing four readers consult to answer
 * "did this run's work move elsewhere?" — a question the schema already answers:
 * approve sets `parent_run_id` on every child it creates
 * (`approve-production-run.ts:226`). The blob is a denormalised copy of a typed
 * fact, and a copy is exactly what goes stale, gets half-written, or gets
 * dropped by a metadata merge that meant to preserve it.
 *
 * So: children by `parent_run_id` are the answer; the blob survives only as a
 * fallback for rows written before this existed.
 *
 * ## 🔴 Empty is not an answer
 *
 * An empty result is indistinguishable from "this run was never split" — the
 * same trap `partner-stores-link.ts` documents about itself, and the reason
 * #2043 and #2044 both kept their blob. A misspelled filter here returns `[]`
 * rather than throwing, and every caller would then read "not superseded" and
 * bill a parent alongside its own child — which is the ₹1,200-times-three
 * defect #2026 exists to stop. Callers therefore treat an empty map as
 * "unknown, ask the blob", never as "no children".
 */
export async function fetchChildRunIdsByParent(
  container: MedusaContainer,
  parentRunIds: string[]
): Promise<Map<string, string[]>> {
  const byParent = new Map<string, string[]>()

  /**
   * ⚠️ Filter BEFORE stringifying. `String(null)` is the five-character string
   * `"null"`, which sails through `filter(Boolean)` and becomes a real filter
   * value — a query for children of a parent named "null", which returns
   * nothing and looks exactly like a parent that was never split.
   */
  const ids = Array.from(
    new Set(
      (parentRunIds ?? [])
        .filter((v): v is string => typeof v === "string" && v.length > 0)
        .map(String)
    )
  )
  if (!ids.length) {
    return byParent
  }

  try {
    const service: any = container.resolve(PRODUCTION_RUNS_MODULE)

    /**
     * `take: null` — every child, not a page of them.
     *
     * A parent split five ways whose query returns three is not a smaller
     * answer, it is a WRONG one: the two missing children are the runs that
     * carry the work, and a caller reading the short list would report the
     * parent as superseded by the wrong set. The repo's own batched-children
     * read at `api/admin/production-runs/route.ts:346` takes
     * `parents.length` rows for exactly this shape, which under-fetches the
     * moment one parent has more children than there are parents.
     */
    const children = await service.listProductionRuns(
      { parent_run_id: ids },
      { select: ["id", "parent_run_id"], take: null }
    )

    for (const child of children ?? []) {
      const parent = child?.parent_run_id ? String(child.parent_run_id) : null
      const childId = child?.id ? String(child.id) : null
      if (!parent || !childId) continue
      const bucket = byParent.get(parent)
      if (bucket) {
        bucket.push(childId)
      } else {
        byParent.set(parent, [childId])
      }
    }
  } catch (e) {
    /**
     * Swallowed on purpose, and the caller's fallback is what makes that safe:
     * an empty map means "I could not tell", and every caller then falls back
     * to the blob it used before this function existed. Throwing would take a
     * payables screen or a partner's order list down over a read that is only
     * ever an OPTIMISATION on a fact the blob still carries.
     */
    const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
    logger?.warn?.(
      `[run-children] could not read child runs for ${ids.length} parent(s); callers fall back to metadata: ${
        (e as any)?.message ?? e
      }`
    )
    return new Map<string, string[]>()
  }

  return byParent
}

/**
 * The one-run form. Same rules, same meaning for an empty array.
 */
export async function fetchChildRunIds(
  container: MedusaContainer,
  parentRunId: string
): Promise<string[]> {
  const byParent = await fetchChildRunIdsByParent(container, [parentRunId])
  return byParent.get(String(parentRunId)) ?? []
}

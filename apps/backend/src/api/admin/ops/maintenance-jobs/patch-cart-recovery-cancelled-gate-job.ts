import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { VISUAL_FLOWS_MODULE } from "../../../../modules/visual_flows"
import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

/**
 * Stop the cart-recovery flow chasing a buyer whose order we CANCELLED.
 *
 * ## Why a job and not a code change
 *
 * Cancelling a design order is soft — it stamps `metadata.cancelled_at` and
 * deletes nothing. The recovery flow's `classify` gate skips converted carts,
 * the send cap, carts with no items and carts with no email. It does not look
 * at that stamp, so a withdrawn order keeps earning reminder mail.
 *
 * The gate is not in this repository at runtime. It is sandboxed JavaScript
 * stored in `visual_flow_operation.options.code`, seeded once by
 * `scripts/seed-cart-recovery-flow.ts`. Editing the script fixes what a FUTURE
 * seed would write and changes nothing that is running.
 *
 * 🔴 And the script cannot be re-run to fix it: it "refuses to overwrite", so
 * a re-seed means DELETING the live flow first — and it recreates the flow in
 * `draft`. That would take cart recovery offline for every tenant until
 * somebody remembered to activate it, which looks exactly like "no carts were
 * abandoned". A silent platform-wide outage is a worse bug than the one being
 * fixed.
 *
 * So this patches the one node, in place, idempotently.
 *
 * ## What it guarantees
 *
 * Idempotent — a flow already carrying the gate is reported and left alone, so
 * running it twice is safe and running it after a future re-seed is harmless.
 *
 * Refuses rather than guesses. If the anchor is missing the live flow is not
 * the one this job was written against, and inserting the gate somewhere
 * plausible could put a `continue` inside the wrong loop. It reports what it
 * found instead. See [[the anchor check]] below.
 */

export const CART_RECOVERY_FLOW_NAME = "Cart Recovery — Hourly Discoverer"
export const CLASSIFY_OPERATION_KEY = "classify"

/**
 * The block we hang the new gate off. It is the LAST skip-rule in the gate,
 * so inserting after it keeps the cheap checks first and reads in the same
 * order as the seed script.
 */
const ANCHOR = `  if (md.converted_order_id) {`

/** Already patched? Matched on the metadata key, not on formatting. */
export const hasCancelledGate = (code: string): boolean =>
  /md\.cancelled_at/.test(String(code ?? ""))

export const CANCELLED_GATE = `  // A design order that was CANCELLED must never get a recovery email. The
  // cancel is soft — it stamps metadata.cancelled_at and deletes nothing — so
  // without this the cart still looks abandoned-but-live and we keep chasing a
  // buyer for an order we withdrew. The redeem route refuses these too.
  if (typeof md.cancelled_at === "string" && md.cancelled_at.trim()) {
    counts.cancelled = (counts.cancelled || 0) + 1
    continue
  }
`

export type PatchOutcome =
  | { ok: true; code: string }
  | { ok: false; reason: "already_patched" | "anchor_missing" | "no_code" }

/**
 * PURE: insert the gate after the `converted_order_id` block.
 *
 * ⚠️ Finds the END of that block — the first `}` at the block's own indent
 * after the anchor — rather than matching the whole block verbatim. The body
 * has been edited by hand before, so its inner lines are not something to
 * depend on; its shape is.
 */
export const patchClassifyCode = (code: unknown): PatchOutcome => {
  const src = typeof code === "string" ? code : ""
  if (!src.trim()) return { ok: false, reason: "no_code" }
  if (hasCancelledGate(src)) return { ok: false, reason: "already_patched" }

  const at = src.indexOf(ANCHOR)
  if (at === -1) return { ok: false, reason: "anchor_missing" }

  const lines = src.split("\n")
  const anchorLine = lines.findIndex((l) => l.includes("if (md.converted_order_id) {"))
  if (anchorLine === -1) return { ok: false, reason: "anchor_missing" }

  const indent = (lines[anchorLine].match(/^\s*/) ?? [""])[0]
  let close = -1
  for (let i = anchorLine + 1; i < lines.length; i++) {
    if (lines[i] === `${indent}}`) {
      close = i
      break
    }
  }
  if (close === -1) return { ok: false, reason: "anchor_missing" }

  const patched = [
    ...lines.slice(0, close + 1),
    ...CANCELLED_GATE.replace(/\n$/, "").split("\n"),
    ...lines.slice(close + 1),
  ].join("\n")

  return { ok: true, code: patched }
}

/** Operator-facing sentence. Exported so the wording is testable. */
export const summarizePatch = (
  dryRun: boolean,
  outcome: PatchOutcome
): string => {
  if (outcome.ok) {
    return dryRun
      ? `Would add the cancelled-order gate to the "${CLASSIFY_OPERATION_KEY}" node. A cancelled design order would stop receiving recovery mail.`
      : `Added the cancelled-order gate to the "${CLASSIFY_OPERATION_KEY}" node. Cancelled design orders no longer receive recovery mail.`
  }
  switch (outcome.reason) {
    case "already_patched":
      return `Already patched — the "${CLASSIFY_OPERATION_KEY}" node reads metadata.cancelled_at. Nothing to do.`
    case "anchor_missing":
      return `REFUSED: the "${CLASSIFY_OPERATION_KEY}" node does not contain the expected \`if (md.converted_order_id) {\` block, so the live flow is not the one this job was written against. Nothing was changed — inspect the node before patching by hand.`
    case "no_code":
      return `REFUSED: the "${CLASSIFY_OPERATION_KEY}" node carries no code. Nothing was changed.`
  }
}

const paramsSchema = z.object({
  flow_name: z.string().trim().min(1).optional().default(CART_RECOVERY_FLOW_NAME),
})

export const patchCartRecoveryCancelledGateJob: MaintenanceJob = {
  id: "patch-cart-recovery-cancelled-gate",
  label: "Stop cart recovery chasing a cancelled design order",
  description:
    "Insert a `metadata.cancelled_at` skip into the cart-recovery flow's `classify` node, so a design order that was CANCELLED stops receiving recovery mail. The gate lives in sandboxed code on a database row (visual_flow_operation.options.code), not in the repository, so a deploy cannot fix it — and the seed script refuses to overwrite, meaning a re-seed would require deleting the live flow and would recreate it in DRAFT, silently taking cart recovery offline for every tenant. This patches the one node in place. IDEMPOTENT: a flow already carrying the gate is reported and left alone. REFUSES rather than guesses if the expected `converted_order_id` block is absent, because inserting a `continue` into an unknown body could skip the wrong loop. Preview (default) shows the exact before/after of the node's code.",
  params: [
    {
      name: "flow_name",
      type: "string",
      required: false,
      description: `Flow to patch (default "${CART_RECOVERY_FLOW_NAME}")`,
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = paramsSchema.safeParse(params ?? {})
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { flow_name } = parsed.data

    const service: any = container.resolve(VISUAL_FLOWS_MODULE)

    const flows = (await service.listVisualFlows({ name: flow_name })) as any[]
    if (!flows?.length) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `No visual flow named "${flow_name}"`
      )
    }
    if (flows.length > 1) {
      /**
       * Never `flows[0]`. Two flows with this name means someone re-seeded
       * without deleting, and patching an arbitrary one leaves the other live
       * and unfixed while reporting success.
       */
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `${flows.length} flows are named "${flow_name}" — refusing to guess which one is live. Ids: ${flows
          .map((f) => f.id)
          .join(", ")}`
      )
    }

    const flow = flows[0]

    const ops = (await service.listVisualFlowOperations({
      flow_id: flow.id,
      operation_key: CLASSIFY_OPERATION_KEY,
    })) as any[]

    if (!ops?.length) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Flow "${flow_name}" has no "${CLASSIFY_OPERATION_KEY}" operation`
      )
    }

    const op = ops[0]
    const options = (op?.options ?? {}) as Record<string, unknown>
    const outcome = patchClassifyCode(options.code)

    const changes: MaintenanceChange[] = []

    if (outcome.ok) {
      changes.push({
        entity: "visual_flow_operation",
        id: op.id,
        field: "options.code",
        before: String(options.code ?? ""),
        after: outcome.code,
        note: `Flow "${flow_name}" (${flow.id}, status ${flow.status ?? "unknown"}): the classify gate does not read metadata.cancelled_at, so a cancelled design order still receives recovery mail.`,
      })

      if (!dry_run) {
        await service.updateVisualFlowOperations({
          id: op.id,
          options: { ...options, code: outcome.code },
        })
      }
    }

    return {
      job_id: "patch-cart-recovery-cancelled-gate",
      dry_run,
      applied: !dry_run && outcome.ok,
      summary: summarizePatch(dry_run, outcome),
      changes,
    }
  },
}

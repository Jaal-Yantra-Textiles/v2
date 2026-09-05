import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
  TransactionHandlerType,
} from "@medusajs/framework/utils"
import { IWorkflowEngineService } from "@medusajs/framework/types"
import { StepResponse } from "@medusajs/framework/workflows-sdk"

import {
  idExtractionBatchWorkflow,
  idExtractionBatchWorkflowId,
  waitConfirmationIdExtractionBatchStepId,
} from "../../../../../workflows/ai/id-extraction-batch"
import { getPartnerFromAuthContext } from "../../../helpers"
import { PERSON_MODULE } from "../../../../../modules/person"
import type { PartnerIdExtractionBatchReqType } from "./validators"

/**
 * POST /partners/people/id-extraction/batch
 *
 * A partner photographs ten weavers and submits them together (#1816).
 *
 * Returns **202** with a `transaction_id` and a `batch_id`. Nothing has been
 * read yet — that starts on confirm, and then runs in the background one photo
 * at a time. This is the whole point: the single-photo route does its vision
 * round-trip inside the request, behind Cloudflare's 100s edge limit, and
 * #1813 is what that costs when a provider is slow.
 *
 * 🔴 It produces DRAFTS. No person exists until somebody approves one.
 *
 * ⚠️ A new partner route 401s until `middlewares.ts` names it. Auth here is
 * per-route and neither tsc nor a green suite will tell you.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const body = (req.validatedBody ?? req.body) as PartnerIdExtractionBatchReqType

  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner?.id) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner is associated with this session."
    )
  }

  const { result, transaction } = await idExtractionBatchWorkflow(req.scope).run({
    input: {
      image_urls: body.image_urls,
      notes: body.notes ?? null,
      id_number_policy: body.id_number_policy ?? "mask",
      person_type_ids: body.person_type_ids ?? null,
      interval_ms: body.interval_ms,
      partner_id: partner.id,
      scope: "pending",
    },
  })

  const out = result as any
  const transaction_id = (transaction as any)?.transactionId

  /**
   * Store the transaction on the batch so every later call is addressed by
   * `batch_id` alone. A client that had to carry both would eventually send
   * the wrong one.
   */
  if (transaction_id && out?.batch_id) {
    const service: any = req.scope.resolve(PERSON_MODULE)
    await service
      .updateIdExtractionBatches({
        selector: { id: out.batch_id },
        data: { transaction_id },
      })
      .catch(() => {})
  }

  let confirmed = false
  if (body.auto_confirm && transaction_id) {
    const engine: IWorkflowEngineService = req.scope.resolve(
      Modules.WORKFLOW_ENGINE
    )
    await engine.setStepSuccess({
      idempotencyKey: {
        action: TransactionHandlerType.INVOKE,
        transactionId: transaction_id,
        stepId: waitConfirmationIdExtractionBatchStepId,
        workflowId: idExtractionBatchWorkflowId,
      },
      stepResponse: new StepResponse(true),
    })
    confirmed = true
  }

  return res.status(202).json({
    message: confirmed
      ? "Reading started. Poll the batch for progress; drafts appear as each photograph is read."
      : "Batch created. Confirm it to start reading.",
    batch_id: out.batch_id,
    transaction_id,
    total_images: out.total_images,
    confirmed,
  })
}

/**
 * GET /partners/people/id-extraction/batch
 *
 * The partner's own batches, newest first.
 *
 * 🔴 Scoped to the authenticated partner. Never accepts a partner_id.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner?.id) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner is associated with this session."
    )
  }

  const service: any = req.scope.resolve(PERSON_MODULE)
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  const limit = Math.min(Number(req.query.limit ?? 20) || 20, 100)
  const offset = Number(req.query.offset ?? 0) || 0

  const [batches, count] = await service.listAndCountIdExtractionBatches(
    { partner_id: partner.id },
    { order: { created_at: "DESC" }, take: limit, skip: offset }
  )

  // Counts per batch, so a list screen can say "7 of 10 read" without an
  // N+1 of item fetches from the client.
  const withCounts = await Promise.all(
    (batches ?? []).map(async (b: any) => {
      try {
        const items = await service.listIdExtractionBatchItems({ batch_id: b.id })
        const by = (s: string) =>
          items.filter((i: any) => i.status === s).length
        return {
          ...b,
          total: items.length,
          completed: by("completed"),
          failed: by("failed"),
          approved: by("approved"),
          pending: by("pending"),
        }
      } catch (e) {
        logger?.warn?.(`[id-extraction-batch] count failed for ${b.id}: ${e}`)
        return b
      }
    })
  )

  return res.json({ batches: withCounts, count, limit, offset })
}

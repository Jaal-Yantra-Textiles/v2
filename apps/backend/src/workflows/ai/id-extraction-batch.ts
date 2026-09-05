/**
 * Batch ID-card extraction as a long-running, rate-limited, resumable job (#1816).
 *
 * Asked by the founder: *"if we upload like 10 photos can it handle this —
 * maybe when many photos are uploaded it should run the long-running workflow
 * and return them through rate limit and failure aware, with iteration to
 * create the data out of it."*
 *
 * Today `add_person_from_id_card` is one image, one synchronous request, behind
 * Cloudflare's 100s edge limit. Ten photos is ten of those, each its own chance
 * to hit what #1813 hit — a 504 at 60s with the provider still retrying for
 * another eleven minutes — and no record of which ones landed.
 *
 * The shape here is `textile-folder-extraction`'s, which was built for exactly
 * this problem with photographs of cloth:
 *
 *   1. Trigger returns `202` + `transaction_id`; an async step suspends.
 *   2. A confirm route resumes it; processing continues in the background.
 *   3. One photo at a time on a configurable interval, so the provider is
 *      never hammered.
 *   4. Per-item errors recorded, with a retry that re-runs only what failed.
 *
 * ## Two things this does differently, both deliberate
 *
 * 🔴 **It produces DRAFTS, never people.** The same ID card read five times in
 * prod did not split the name identically — 4x "Tarun Debnath", 1x "Tarun". One
 * photo at a time, an operator sees that and fixes it. Ten at a time, it seeds
 * a roster with wrong names and nothing marks which. Approval is a separate,
 * human act; see `approveIdExtractionBatchItemsWorkflow`.
 *
 * 🔑 **The work-list is a question about state, not a loop position.** Items
 * carry their own `status`, so the processing step asks the database what is
 * still `pending`. A deploy kills a long in-process loop without warning and
 * leaves `status` saying `running` (#1742) — deriving the work from rows is
 * what makes a resume finish the batch instead of re-doing it.
 */

import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  WorkflowData,
  transform,
} from "@medusajs/framework/workflows-sdk";
import { MedusaError } from "@medusajs/framework/utils";
import {
  notifyOnFailureStep,
  sendNotificationsStep,
} from "@medusajs/medusa/core-flows";

import { PERSON_MODULE } from "../../modules/person";
import { type IdNumberPolicy } from "../../lib/people/id-card";
import {
  providerGateKey,
  resolveMaxConcurrency,
  withProviderSlot,
} from "../../lib/ai/provider-gate";
import { extractPersonFromIdWorkflow } from "./extract-person-from-id";

// ============================================
// Types
// ============================================

export type IdExtractionBatchInput = {
  /** The photographs, in the order the caller submitted them. */
  image_urls?: string[];
  /** Set by the confirm/retry paths to work an existing batch. */
  batch_id?: string;
  partner_id?: string | null;
  notes?: string | null;
  id_number_policy?: IdNumberPolicy;
  person_type_ids?: string[] | null;
  /** Milliseconds between photos. Default 20000. */
  interval_ms?: number;
  /**
   * Which items this run is for.
   *
   * - `"pending"` (default) — everything not yet read. Makes a re-run a RESUME.
   * - `"failed"` — only the ones that failed, which is what the retry route wants.
   */
  scope?: "pending" | "failed";
};

export type IdExtractionBatchSummary = {
  batch_id: string;
  status: "pending_confirmation" | "processing";
  message: string;
  total_images: number;
};

// ============================================
// Rate limiting
// ============================================

/**
 * Default pacing: one photo every 20 seconds.
 *
 * Slower than it needs to be for a single provider on a good day — prod
 * measured gemma at 5.2-9.4s per read — and deliberately so. #1819 records
 * `nemotron` answering one call in 573ms and rate-limiting the very next one
 * with `ResourceExhausted: Worker local total request limit`. One user, two
 * calls. Until there is a shared queue, the interval IS the rate limit.
 *
 * Ten photos at this pace is ~3 minutes, in the background, with a report.
 */
export const DEFAULT_ID_BATCH_INTERVAL_MS = 20 * 1000;
/** Never go faster than this regardless of configuration. */
export const MIN_ID_BATCH_INTERVAL_MS = 5 * 1000;
/** Never wait longer than this between photos. */
export const MAX_ID_BATCH_INTERVAL_MS = 10 * 60 * 1000;

/** Beyond this a batch is a bulk import and wants a different conversation. */
export const MAX_ID_BATCH_IMAGES = 50;

export const clampIdBatchInterval = (ms?: number): number => {
  const value =
    typeof ms === "number" && Number.isFinite(ms)
      ? ms
      : DEFAULT_ID_BATCH_INTERVAL_MS;
  return Math.min(
    Math.max(value, MIN_ID_BATCH_INTERVAL_MS),
    MAX_ID_BATCH_INTERVAL_MS
  );
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ============================================
// Workflow ids (the confirm route needs these)
// ============================================

export const idExtractionBatchWorkflowId = "id-extraction-batch";
export const waitConfirmationIdExtractionBatchStepId =
  "wait-confirmation-id-extraction-batch";

// ============================================
// Steps
// ============================================

/**
 * Suspends until the caller confirms. Long timeout: a batch may sit while
 * someone checks they photographed the right ten people.
 */
export const waitConfirmationIdExtractionBatchStep = createStep(
  {
    name: waitConfirmationIdExtractionBatchStepId,
    async: true,
    timeout: 60 * 60 * 24,
  },
  async () => {
    // Suspends here until workflowEngineService.setStepSuccess() is called.
  }
);

/**
 * Creates the batch row and one item per photograph.
 *
 * Compensation deletes them, so a trigger that fails after this step does not
 * leave an orphan batch sitting at `pending_confirmation` forever.
 */
const createIdExtractionBatchStep = createStep(
  "create-id-extraction-batch",
  async (input: IdExtractionBatchInput, { container }) => {
    const service: any = container.resolve(PERSON_MODULE);

    const urls = (input.image_urls ?? []).map((u) => String(u ?? "").trim());

    if (urls.length === 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "A batch needs at least one image_url."
      );
    }
    if (urls.length > MAX_ID_BATCH_IMAGES) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `A batch is capped at ${MAX_ID_BATCH_IMAGES} photographs; ${urls.length} were submitted.`
      );
    }

    const batch = await service.createIdExtractionBatches({
      partner_id: input.partner_id ?? null,
      status: "pending_confirmation",
      interval_ms: clampIdBatchInterval(input.interval_ms),
      id_number_policy: input.id_number_policy ?? "mask",
      person_type_ids: input.person_type_ids ?? null,
      notes: input.notes ?? null,
      resume_attempts: 0,
    });

    const batch_id = Array.isArray(batch) ? batch[0].id : batch.id;

    await service.createIdExtractionBatchItems(
      urls.map((image_url, i) => ({
        batch_id,
        position: i + 1,
        image_url,
        status: "pending",
        attempts: 0,
      }))
    );

    return new StepResponse(
      { batch_id, total: urls.length },
      { batch_id }
    );
  },
  async (data: { batch_id: string } | undefined, { container }) => {
    if (!data?.batch_id) return;
    try {
      const service: any = container.resolve(PERSON_MODULE);
      const items = await service.listIdExtractionBatchItems({
        batch_id: data.batch_id,
      });
      if (items?.length) {
        await service.deleteIdExtractionBatchItems(
          items.map((i: any) => i.id)
        );
      }
      await service.deleteIdExtractionBatches(data.batch_id);
    } catch {
      // Compensation must not throw; an orphan row is better than a masked error.
    }
  }
);

/**
 * Reads every OUTSTANDING photo in the batch, one at a time, sleeping
 * `interval_ms` between them.
 *
 * 🔑 The loop asks the database for its work rather than trusting an input
 * list, so a second run after a deploy picks up exactly what is left.
 */
const processIdExtractionBatchStep = createStep(
  "process-id-extraction-batch",
  async (
    input: { batch_id: string; scope: "pending" | "failed" },
    { container }
  ) => {
    const service: any = container.resolve(PERSON_MODULE);

    const batch = await service
      .retrieveIdExtractionBatch(input.batch_id)
      .catch(() => null);
    if (!batch) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Batch not found: ${input.batch_id}`
      );
    }

    const wanted =
      input.scope === "failed" ? ["failed"] : ["pending", "failed"];

    const items = (
      await service.listIdExtractionBatchItems(
        { batch_id: input.batch_id },
        { order: { position: "ASC" } }
      )
    ).filter((i: any) => wanted.includes(i.status));

    await service.updateIdExtractionBatches({
      selector: { id: input.batch_id },
      data: { status: "running", started_at: new Date() },
    });

    let completed = 0;
    let failed = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const isLast = i === items.length - 1;

      try {
        /**
         * The single-photo workflow IS the reader. Reusing it rather than
         * re-implementing the ladder keeps one source of truth for the time
         * budget, the text-only skip and the blind-read rejection that #1813
         * put there — a second copy would drift, and the drift would show up
         * as "the batch reads cards differently from the single photo".
         *
         * `persist: false` always: this path produces drafts, never people.
         */
        /**
         * 🔑 #1819's acceptance test: this loop no longer manages its own
         * pacing alone. The interval below is a floor; the GATE is the ceiling,
         * and it is shared with every other process and every other feature on
         * the same provider account.
         *
         * The gate is keyed on the vision ladder's own account. The ladder can
         * fall through several rungs inside one call, so the key here is the
         * ROLE's default account — a coarse gate that is honest about the
         * common case, rather than a precise one that would need the ladder to
         * report which rung it used before we could hold a slot for it.
         */
        const gateKey = providerGateKey({
          providerType: "ai_image_extraction",
          accountId: null,
          baseUrl: null,
        });

        const { result } = await withProviderSlot(
          container,
          gateKey,
          () =>
            extractPersonFromIdWorkflow(container).run({
              input: {
                image_url: item.image_url,
                notes: batch.notes ?? null,
                id_number_policy: (batch.id_number_policy ??
                  "mask") as IdNumberPolicy,
                persist: false,
                partner_id: batch.partner_id ?? null,
                person_type_ids: null,
              },
            }),
          {
            maxConcurrency: resolveMaxConcurrency("ai_image_extraction"),
            label: `id-batch:${input.batch_id}`,
          }
        );

        const read = result as any;

        await service.updateIdExtractionBatchItems({
          selector: { id: item.id },
          data: {
            status: "completed",
            draft: read.draft,
            model_used: read.model ?? null,
            error: null,
            attempts: (item.attempts ?? 0) + 1,
            attempted_at: new Date(),
          },
        });
        completed++;
      } catch (error: any) {
        const message = error?.message ?? String(error);
        await service.updateIdExtractionBatchItems({
          selector: { id: item.id },
          data: {
            status: "failed",
            error: message,
            attempts: (item.attempts ?? 0) + 1,
            attempted_at: new Date(),
          },
        });
        failed++;
      }

      // Only sleep BETWEEN photos, never after the last one.
      if (!isLast) {
        await sleep(batch.interval_ms ?? DEFAULT_ID_BATCH_INTERVAL_MS);
      }
    }

    return new StepResponse({
      batch_id: input.batch_id,
      attempted: items.length,
      completed,
      failed,
    });
  }
);

/**
 * Closes the batch.
 *
 * 🔴 `failed` means NOTHING was read. A batch where nine of ten worked is
 * `completed` with a failure count — calling that "failed" would bury nine
 * usable drafts behind a word that tells an operator to start over.
 */
const finalizeIdExtractionBatchStep = createStep(
  "finalize-id-extraction-batch",
  async (
    input: {
      batch_id: string;
      attempted: number;
      completed: number;
      failed: number;
    },
    { container }
  ) => {
    const service: any = container.resolve(PERSON_MODULE);

    const status =
      input.completed === 0 && input.failed > 0 ? "failed" : "completed";

    await service.updateIdExtractionBatches({
      selector: { id: input.batch_id },
      data: { status, finished_at: new Date() },
    });

    return new StepResponse({ ...input, status });
  }
);

// ============================================
// Background processing workflow
// ============================================

/**
 * Runs the rate-limited loop. Invoked via `runAsStep` with
 * `backgroundExecution: true` so the trigger's HTTP response is not waiting on
 * it — which is the entire point, given the edge limit that started this.
 */
export const idExtractionBatchProcessingWorkflow = createWorkflow(
  "id-extraction-batch-processing",
  (input: WorkflowData<{ batch_id: string; scope: "pending" | "failed" }>) => {
    const summary = processIdExtractionBatchStep(input);

    const finalizeInput = transform({ summary }, (d) => ({
      batch_id: d.summary.batch_id,
      attempted: d.summary.attempted,
      completed: d.summary.completed,
      failed: d.summary.failed,
    }));

    const finalized = finalizeIdExtractionBatchStep(finalizeInput);

    return new WorkflowResponse(finalized);
  }
);

// ============================================
// Main workflow
// ============================================

/**
 * Usage:
 *   1. `POST /partners/people/id-extraction/batch` -> 202 + transaction_id + batch_id
 *   2. `POST /partners/people/id-extraction/batch/:transaction_id/confirm`
 *   3. Poll `GET /partners/people/id-extraction/batch/:id`
 *   4. Approve the drafts you want as people.
 */
export const idExtractionBatchWorkflow = createWorkflow(
  {
    name: idExtractionBatchWorkflowId,
    store: true,
  },
  (
    input: WorkflowData<IdExtractionBatchInput>
  ): WorkflowResponse<IdExtractionBatchSummary> => {
    const created = createIdExtractionBatchStep(input);

    const initialSummary = transform({ created }, (d) => ({
      batch_id: d.created.batch_id,
      status: "pending_confirmation" as const,
      message: `${d.created.total} photograph(s) ready to read. Confirm to start; they are read one at a time in the background and produce drafts to approve.`,
      total_images: d.created.total,
    }));

    waitConfirmationIdExtractionBatchStep();

    const failureNotification = transform({ created }, (d) => [
      {
        to: "",
        channel: "feed" as const,
        template: "admin-ui" as const,
        data: {
          title: "ID batch extraction failed",
          description: `Batch ${d.created.batch_id} could not be read.`,
        },
      },
    ]);

    notifyOnFailureStep(failureNotification);

    const processingInput = transform({ created, input }, (d) => ({
      batch_id: d.created.batch_id,
      scope: (d.input.scope === "failed" ? "failed" : "pending") as
        | "pending"
        | "failed",
    }));

    idExtractionBatchProcessingWorkflow
      .runAsStep({ input: processingInput })
      .config({ async: true, backgroundExecution: true });

    const successNotification = transform({ created }, (d) => [
      {
        to: "",
        channel: "feed" as const,
        template: "admin-ui" as const,
        data: {
          title: "ID batch extraction finished",
          description: `Batch ${d.created.batch_id} has drafts waiting for approval.`,
        },
      },
    ]);

    sendNotificationsStep(successNotification);

    return new WorkflowResponse(initialSummary);
  }
);

export default idExtractionBatchWorkflow;

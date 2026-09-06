/**
 * Turning batch drafts into people — the human half of #1816.
 *
 * 🔴 This is a SEPARATE act on purpose. The reading workflow never creates a
 * person, however confident the model sounded. In prod the same ID card read
 * five times did not split the name identically (4x "Tarun Debnath", 1x
 * "Tarun"); at one photo a time an operator catches that, at ten a time it
 * seeds a roster with wrong names and nothing marks which ones. So the drafts
 * sit until somebody says which are right.
 *
 * Partial success is the normal case and is reported per item, not thrown:
 * approving eight of ten must not roll back the eight because the ninth had no
 * surname.
 */

import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  WorkflowData,
} from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import type { Link } from "@medusajs/framework/modules-sdk";

import { PERSON_MODULE } from "../../modules/person";
import { PARTNER_MODULE } from "../../modules/partner";
import {
  personCreateInputFromDraft,
  type PersonDraft,
} from "../../lib/people/id-card";

export type ApproveIdExtractionBatchInput = {
  batch_id: string;
  /**
   * Which items to approve. Omitted means every item that carries a usable
   * draft — the "accept the batch" button.
   */
  item_ids?: string[] | null;
  /**
   * Edits keyed by item id, applied over the draft before the person is built.
   * This is where an operator's correction of "Tarun" to "Tarun Debnath" lands.
   */
  corrections?: Record<string, Partial<PersonDraft>> | null;
  /** Guard against approving someone else's batch. Filled from auth. */
  partner_id?: string | null;
};

export type ApproveIdExtractionBatchResult = {
  batch_id: string;
  approved: number;
  skipped: number;
  results: Array<{
    item_id: string;
    position: number;
    status: "approved" | "skipped";
    person_id?: string;
    reason?: string;
  }>;
};

const approveItemsStep = createStep(
  "approve-id-extraction-batch-items",
  async (input: ApproveIdExtractionBatchInput, { container }) => {
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

    /**
     * 🔴 Ownership is checked against the row, not taken from the caller. A
     * partner approving another partner's batch would be a cross-tenant write,
     * and the batch is the only thing that knows whose it is.
     */
    if (input.partner_id && batch.partner_id !== input.partner_id) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "That batch belongs to another partner."
      );
    }

    let items = await service.listIdExtractionBatchItems(
      { batch_id: input.batch_id },
      { order: { position: "ASC" } }
    );

    if (input.item_ids?.length) {
      const wanted = new Set(input.item_ids);
      items = items.filter((i: any) => wanted.has(i.id));
    }

    const created_person_ids: string[] = [];
    const results: ApproveIdExtractionBatchResult["results"] = [];
    let approved = 0;
    let skipped = 0;

    for (const item of items) {
      const skip = (reason: string) => {
        skipped++;
        results.push({
          item_id: item.id,
          position: item.position,
          status: "skipped",
          reason,
        });
      };

      if (item.status === "approved" && item.person_id) {
        /**
         * Approving twice must not create twice. The row already carries the
         * person, so this is reported as a skip rather than an error — a
         * double-click is not a failure.
         */
        skip("Already approved.");
        continue;
      }

      if (!item.draft) {
        skip(
          item.status === "failed"
            ? `Never read successfully: ${item.error ?? "unknown error"}`
            : "Not read yet."
        );
        continue;
      }

      const draft: PersonDraft = {
        ...(item.draft as PersonDraft),
        ...((input.corrections?.[item.id] ?? {}) as Partial<PersonDraft>),
      };

      /**
       * A correction can RESCUE a draft the reader refused. `creatable` was
       * computed when the model answered; if an operator has since supplied the
       * missing name, the old verdict is stale — so recompute it from the name
       * rather than trusting the stored flag.
       */
      const has_name = Boolean(
        String(draft.first_name ?? "").trim() ||
          String(draft.last_name ?? "").trim()
      );

      if (!has_name) {
        skip("No name on the draft — supply a correction first.");
        continue;
      }

      try {
        const payload = personCreateInputFromDraft(
          { ...draft, creatable: true } as PersonDraft,
          {
            source_image_url: item.image_url,
            created_via: "id_card_batch_extraction",
          }
        );

        const created = await service.createPeople(payload);
        const person = Array.isArray(created) ? created[0] : created;

        if (person?.id) {
          created_person_ids.push(person.id);
        }

        // Address is best-effort: a person with no address is recoverable, a
        // half-created person is not.
        if (draft.address && person?.id) {
          const a = draft.address;
          try {
            await service.createAddresses({
              person_id: person.id,
              street: a.street ?? "",
              city: a.city ?? "",
              state: a.state ?? "",
              postal_code: a.postal_code ?? "",
              country: a.country ?? "",
            });
          } catch {
            /* best-effort */
          }
        }

        // The link is what puts them on the partner's roster. Reported, not
        // rolled back — an unlinked person is invisible but not lost.
        let link_error: string | null = null;
        if (batch.partner_id && person?.id) {
          try {
            const link: Link = container.resolve(ContainerRegistrationKeys.LINK);
            await link.create({
              [PARTNER_MODULE]: { partner_id: batch.partner_id },
              [PERSON_MODULE]: { person_id: person.id },
            });
          } catch (e: any) {
            link_error = e?.message ?? String(e);
          }
        }

        await service.updateIdExtractionBatchItems({
          selector: { id: item.id },
          data: {
            status: "approved",
            person_id: person?.id ?? null,
            draft,
            error: link_error,
          },
        });

        approved++;
        results.push({
          item_id: item.id,
          position: item.position,
          status: "approved",
          person_id: person?.id,
          ...(link_error ? { reason: `Created, but not linked: ${link_error}` } : {}),
        });
      } catch (e: any) {
        skip(e?.message ?? String(e));
      }
    }

    return new StepResponse(
      { batch_id: input.batch_id, approved, skipped, results },
      { created_person_ids, partner_id: batch.partner_id ?? null }
    );
  },
  /*
   * 🔴 DISMISS THE LINKS BEFORE DELETING THE PEOPLE.
   *
   * This compensation used to call `deletePeople` alone — a HARD delete — on
   * people this step had already linked to the partner above. The person rows
   * went; the link rows stayed. That is a machine for producing exactly the
   * shape #1857 describes: a link table pointing at records that do not exist.
   *
   * It is not a bookkeeping detail. Four such rows on one partner made
   * `GET /admin/partners/:id/people` answer `[null,null,null,null]` and took
   * the entire partner detail page down in the admin. The reader is guarded
   * now, but a reader-side guard does not stop the rows appearing — this does.
   *
   * Dismissal is best-effort and per-person: a link that was never created
   * (the `link_error` path above) must not abort the rollback of the ones that
   * were, and a failed dismissal must not leave the people behind either.
   */
  async (
    undo: { created_person_ids: string[]; partner_id: string | null } | undefined,
    { container }
  ) => {
    if (!undo?.created_person_ids?.length) return;

    if (undo.partner_id) {
      const link: Link = container.resolve(ContainerRegistrationKeys.LINK);
      for (const personId of undo.created_person_ids) {
        await link
          .dismiss({
            [PARTNER_MODULE]: { partner_id: undo.partner_id },
            [PERSON_MODULE]: { person_id: personId },
          })
          .catch(() => {});
      }
    }

    const service: any = container.resolve(PERSON_MODULE);
    await service.deletePeople(undo.created_person_ids).catch(() => {});
  }
);

export const approveIdExtractionBatchWorkflow = createWorkflow(
  "approve-id-extraction-batch",
  (
    input: WorkflowData<ApproveIdExtractionBatchInput>
  ): WorkflowResponse<ApproveIdExtractionBatchResult> => {
    const result = approveItemsStep(input);
    return new WorkflowResponse(result);
  }
);

export default approveIdExtractionBatchWorkflow;

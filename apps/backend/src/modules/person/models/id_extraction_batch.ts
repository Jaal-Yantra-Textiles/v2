import { model } from "@medusajs/framework/utils";
import IdExtractionBatchItem from "./id_extraction_batch_item";

/**
 * A run of ID-card reads submitted together (#1816).
 *
 * The single-photo route is one image, one synchronous request, behind
 * Cloudflare's 100s edge limit. Ten photos was ten of those, with no record of
 * which ones landed — #1813 showed what a slow provider does to that shape.
 *
 * 🔑 This row exists so the work-list is a question about STATE rather than
 * about a loop's position. A deploy kills an in-process loop without warning
 * and `status` keeps saying `running`; the only safe way to resume is to ask
 * the database which items are still `pending`. Same lesson the folder
 * extraction learned (#1742).
 */
const IdExtractionBatch = model.define("id_extraction_batch", {
  id: model.id().primaryKey(),

  /**
   * Whose batch this is. Null for an admin-initiated run.
   *
   * 🔴 Filled from the AUTHENTICATED ACTOR on the partner route, never from
   * the body — a batch that took a partner_id from the caller would be a
   * cross-tenant write waiting to happen, the same way the single-photo route
   * has no `partner_id` field at all.
   */
  partner_id: model.text().nullable(),

  status: model
    .enum(["pending_confirmation", "running", "completed", "failed", "cancelled"])
    .default("pending_confirmation"),

  /** Milliseconds between photos. Clamped; see the workflow's bounds. */
  interval_ms: model.number(),

  /**
   * The long-running workflow's transaction, stored when the batch is created.
   *
   * 🔑 Without it the confirm route needs the transaction id in its PATH, which
   * would put `[transaction_id]` next to `[id]` as sibling segments — a routing
   * conflict — and force every client to carry two identifiers for one thing.
   * Keeping it on the row means the whole API is addressed by `batch_id`.
   */
  transaction_id: model.text().nullable(),

  /**
   * The masking policy applied to every item in the run, captured here so a
   * later read of the batch can say what was done rather than guess.
   */
  id_number_policy: model.enum(["mask", "discard"]).default("mask"),

  /** Person-type ids attached to anyone approved out of this batch. */
  person_type_ids: model.json().nullable(),

  notes: model.text().nullable(),

  started_at: model.dateTime().nullable(),
  finished_at: model.dateTime().nullable(),

  /**
   * How many times a stalled run has been resumed. Capped by the sweeper the
   * way `process-email-queue` caps attempts: a batch whose items fail for a
   * reason that will not change must stop costing vision calls.
   *
   * ⚠️ Only the sweeper consults this. A human pressing Resume is never
   * refused on a count — they can see the errors and are making the call.
   */
  resume_attempts: model.number().default(0),

  items: model.hasMany(() => IdExtractionBatchItem, { mappedBy: "batch" }),
});

export default IdExtractionBatch;

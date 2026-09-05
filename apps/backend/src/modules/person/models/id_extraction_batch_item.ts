import { model } from "@medusajs/framework/utils";
import IdExtractionBatch from "./id_extraction_batch";

/**
 * One photograph in a batch (#1816).
 *
 * 🔑 An item is the unit of resume. `status` is what the workflow reads to
 * build its work-list, so re-running a batch finishes it rather than re-doing
 * it — and a deploy that kills the loop mid-run costs at most the item that
 * was in flight.
 */
const IdExtractionBatchItem = model.define("id_extraction_batch_item", {
  id: model.id().primaryKey(),

  /** Position as submitted, so a report can name "photo 7" the way the caller saw it. */
  position: model.number(),

  image_url: model.text(),

  status: model
    .enum(["pending", "completed", "failed", "approved", "discarded"])
    .default("pending"),

  /**
   * What the model read. A DRAFT — never a person.
   *
   * 🔴 The same ID card read five times did not split the name identically
   * (4x "Tarun Debnath", 1x "Tarun"). At ten photos a run, creating people
   * directly would quietly seed a roster with wrong names and no way to tell
   * which were wrong. Approval is a separate, human act.
   */
  draft: model.json().nullable(),

  /**
   * Set only once an operator approves the draft. Until then the read exists
   * and the person does not.
   */
  person_id: model.text().nullable(),

  /**
   * Which model produced the draft, so a bad batch can be traced to a rung
   * rather than blamed on the photographs — the mistake #1813 made.
   */
  model_used: model.json().nullable(),

  error: model.text().nullable(),

  attempts: model.number().default(0),
  attempted_at: model.dateTime().nullable(),

  batch: model.belongsTo(() => IdExtractionBatch, { mappedBy: "items" }),
});

export default IdExtractionBatchItem;

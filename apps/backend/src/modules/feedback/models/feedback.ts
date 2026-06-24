import { model } from "@medusajs/framework/utils";

const Feedback = model.define("feedback", {
  id: model.id().primaryKey(),
  rating: model.enum(["one","two","three","four","five"]).default("three"),
  comment: model.text().nullable(),
  status: model.enum(["pending","reviewed","resolved"]).default("pending"),
  submitted_by: model.text(),
  submitted_at: model.dateTime(),
  // Durable link back to the order this feedback is about (e.g. a
  // post-delivery feedback request, #452). Kept as a typed column rather
  // than in `metadata` so it survives metadata-replacing updates when the
  // customer later submits their rating.
  order_id: model.text().nullable(),
  // Playful post-delivery feedback (#452): the customer is shown a small set
  // of artwork images and picks the one they identify with. The chosen
  // artwork (a media_file id) + an optional affinity label are load-bearing
  // analytical state, so they live in typed columns rather than the metadata
  // blob (which gets fully replaced on update — feedback_no_critical_data_in_metadata).
  chosen_artwork_id: model.text().nullable(),
  artwork_affinity: model.text().nullable(),
  reviewed_by: model.text().nullable(),
  reviewed_at: model.dateTime().nullable(),
  metadata: model.json().nullable(),
});

export default Feedback;

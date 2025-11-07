import { model } from "@medusajs/framework/utils";

const Feedback = model.define("feedback", {
  id: model.id().primaryKey(),
  rating: model.enum(["one","two","three","four","five"]).default("three"),
  comment: model.text().nullable(),
  status: model.enum(["pending","reviewed","resolved"]).default("pending"),
  submitted_by: model.text(),
  submitted_at: model.dateTime(),
  reviewed_by: model.text().nullable(),
  reviewed_at: model.dateTime().nullable(),
  metadata: model.json().nullable(),
});

export default Feedback;

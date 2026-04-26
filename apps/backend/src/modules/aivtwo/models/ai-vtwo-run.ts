import { model } from "@medusajs/framework/utils"

const AiVtwoRun = model.define("ai_vtwo_run", {
  id: model.id().primaryKey(),  
  run_id: model.text().unique().searchable(),
  resource_id: model.text().nullable(),
  thread_id: model.text().nullable(),
  status: model.enum(["running", "suspended", "completed", "error"]).default("running"),
  message: model.text().nullable(),
  reply: model.text().nullable(),
  steps: model.json().nullable(),
  metadata: model.json().nullable(),
})

export default AiVtwoRun

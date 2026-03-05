import { model } from "@medusajs/framework/utils"

const HangTagSettings = model.define("hang_tag_settings", {
  id: model.id({ prefix: "htag_cfg" }).primaryKey(),
  key: model.text().unique(),
  config: model.json().nullable(),
})

export default HangTagSettings

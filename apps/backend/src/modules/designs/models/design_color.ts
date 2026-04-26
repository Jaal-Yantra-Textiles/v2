import { model } from "@medusajs/framework/utils"
import Design from "./design"

const DesignColor = model.define("design_colors", {
  id: model.id().primaryKey(),
  name: model.text().translatable(),
  hex_code: model.text(),
  usage_notes: model.text().translatable().nullable(),
  order: model.number().nullable(),
  metadata: model.json().nullable(),
  design: model.belongsTo(() => Design, {
    mappedBy: "colors",
  }),
})

export default DesignColor

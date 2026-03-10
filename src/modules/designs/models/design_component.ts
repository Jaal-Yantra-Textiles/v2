import { model } from "@medusajs/framework/utils"
import Design from "./design"

const DesignComponent = model.define("design_component", {
  id: model.id().primaryKey(),
  quantity: model.number().default(1),
  role: model.text().nullable(),   // e.g. "embroidery", "lining", "trim", "main_fabric"
  notes: model.text().nullable(),
  order: model.number().default(0), // display order within parent bundle
  metadata: model.json().nullable(),
  // Two foreign keys to Design (self-referential)
  parent_design: model.belongsTo(() => Design, { mappedBy: "components" }),
  component_design: model.belongsTo(() => Design, { mappedBy: "used_in" }),
})

export default DesignComponent

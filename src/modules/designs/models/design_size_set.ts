import { model } from "@medusajs/framework/utils"
import Design from "./design"

const DesignSizeSet = model.define("design_size_sets", {
  id: model.id().primaryKey(),
  size_label: model.text(),
  measurements: model.json().nullable(),
  metadata: model.json().nullable(),
  design: model.belongsTo(() => Design, {
    mappedBy: "size_sets",
  }),
})

export default DesignSizeSet

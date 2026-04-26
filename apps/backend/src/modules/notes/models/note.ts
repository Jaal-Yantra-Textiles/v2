import { model } from "@medusajs/framework/utils"

const Note = model.define("note", {
    id: model.id().primaryKey(),
    entity_id: model.text(),
    entity_name: model.text(),
    note: model.json(),
    
    metadata: model.json().nullable(),
})

export default Note
import { model } from "@medusajs/framework/utils";
import Person from "./person";

const Tag = model.define("person_tags", {
  id: model.id().primaryKey(),
  name: model.json().nullable(),
  person: model.belongsTo(() => Person, { mappedBy: "tags" }),
});

export default Tag;

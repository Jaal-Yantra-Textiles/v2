import { model } from "@medusajs/framework/utils";
import Person from "./person";

const Tag = model.define("tag", {
  id: model.id().primaryKey(),
  name: model.json().nullable(),
  persons: model.manyToMany(() => Person, { mappedBy: "tags" }),
});

export default Tag;

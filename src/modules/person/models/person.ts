import { model } from "@medusajs/framework/utils";
import Address from "./person_address";
import ContactDetail from "./person_contact";
import Tag from "./person_tags";

const Person = model.define("person", {
  id: model.id().primaryKey(),
  first_name: model.text().searchable(),
  last_name: model.text().searchable(),
  email: model.text().unique(),
  date_of_birth: model.dateTime().nullable(),
  metadata: model.json().nullable(),

  avatar: model.text().nullable(),
  addresses: model.hasMany(() => Address, { mappedBy: "person" }),
  contact_details: model.hasMany(() => ContactDetail, { mappedBy: "person" }),
  // REMOVE THE TAGS PART SINCE WE ARE GOING TO USE METADATA GOOD FOR TESTING AND ETC
  tags: model.manyToMany(() => Tag, {
    mappedBy: "persons",
    pivotTable: "person_tags",
    joinColumn: "person_id",
    inverseJoinColumn: "tag_id",
  }),
  state: model
    .enum(["Onboarding", "Stalled", "Conflicted", "Onboarding Finished"])
    .default("Onboarding"),
});

export default Person;

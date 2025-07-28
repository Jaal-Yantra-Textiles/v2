import { model } from "@medusajs/framework/utils";
import Address from "./person_address";
import ContactDetail from "./person_contact";
import Tag from "./person_tags";

const Person = model.define("person", {
  id: model.id().primaryKey(),
  first_name: model.text().searchable(),
  last_name: model.text().searchable(),
  email: model.text().unique().nullable(),
  date_of_birth: model.dateTime().nullable(),
  metadata: model.json().nullable(),
  notes: model.text().nullable(),
  avatar: model.text().nullable(),
  addresses: model.hasMany(() => Address, { mappedBy: "person" }),
  contact_details: model.hasMany(() => ContactDetail, { mappedBy: "person" }),
  
  tags: model.hasMany(() => Tag, { mappedBy: "person" }),
  state: model
    .enum(["Onboarding", "Stalled", "Conflicted", "Onboarding Finished"])
    .default("Onboarding"),
  // This metadata will store imported stuff.
  public_metadata: model.json().nullable(),
});

export default Person;

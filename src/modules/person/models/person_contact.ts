import { model } from "@medusajs/framework/utils";
import Person from "./person";

const ContactDetail = model.define("person_contact_detail", {
  id: model.id().primaryKey(),
  phone_number: model.text(),
  type: model.enum(["mobile", "home", "work"]),
  person: model.belongsTo(() => Person, { mappedBy: "contact_details" }),
});

export default ContactDetail;

import { model } from "@medusajs/framework/utils";

const Company = model.define("companies", {
  id: model.id().primaryKey(),
  name: model.text().searchable(),
  legal_name: model.text(),
  website: model.text().nullable(),
  logo_url: model.text().nullable(),
  email: model.text().unique(),
  phone: model.text(),
  address: model.text(),
  city: model.text(),
  state: model.text(),
  country: model.text(),
  postal_code: model.text(),
  registration_number: model.text().nullable(),
  tax_id: model.text().nullable(),
  status: model.enum([
    "Active",
    "Inactive",
    "Pending",
    "Suspended"
  ]).default("Active"),
  founded_date: model.dateTime().nullable(),
  metadata: model.json().nullable(),
});

export default Company;

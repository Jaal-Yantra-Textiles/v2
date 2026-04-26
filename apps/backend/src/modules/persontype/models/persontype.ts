import { model } from "@medusajs/framework/utils";

const PersonType = model.define("person_type", {
  id: model.id().primaryKey(),
  name: model.text().unique(), // The name of the type (e.g., "Model", "Vendor")
  description: model.text().nullable(), // Optional description
  metadata: model.json().nullable(), // Metadata for extensibility
});

export default PersonType;

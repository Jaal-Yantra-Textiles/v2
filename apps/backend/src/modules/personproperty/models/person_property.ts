import { model } from "@medusajs/framework/utils";

/**
 * Generic profile-properties record attached to a Person.
 *
 * `profile_type` is the discriminator (e.g. "weaver") so the same model can
 * hold typed, filterable attributes for any kind of person profile. Fields are
 * the key attributes people search/segment by; verbose or sensitive data
 * (bank details, photos, yarn breakdown) stays in Person.metadata (private).
 */
const PersonProperty = model.define("person_property", {
  id: model.id().primaryKey(),
  // Discriminator: which kind of profile these properties describe.
  profile_type: model.text().searchable().default("weaver"),

  // Census / individual identity
  census_id: model.text().searchable().nullable(),
  relation_to_head: model.text().nullable(),

  // Demographic filter fields
  gender: model.text().nullable(),
  social_group: model.text().nullable(),
  religion: model.text().nullable(),
  region_state: model.text().nullable(), // census province, e.g. "Uttar Pradesh"
  district: model.text().nullable(),

  // Loom / craft filter fields
  own_looms: model.boolean().nullable(),
  total_looms_owned: model.number().nullable(),
  natural_dye_used: model.boolean().nullable(),

  // Sales-channel filter fields
  sells_local_market: model.boolean().nullable(),
  sells_master_weaver: model.boolean().nullable(),
  sells_cooperative: model.boolean().nullable(),
  sells_ecommerce: model.boolean().nullable(),

  // Support needs (array of labels)
  support_requirements: model.json().nullable(),

  metadata: model.json().nullable(),
});

export default PersonProperty;

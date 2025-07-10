import { model } from "@medusajs/framework/utils";
import { InferTypeOf } from "@medusajs/framework/types";
import Person from "./person";

const Address = model.define("person_address", {
  id: model.id().primaryKey(),
  street: model.text(),
  city: model.text(),
  state: model.text(),
  postal_code: model.text(),
  country: model.text(),
  latitude: model.bigNumber().nullable(),
  longitude: model.bigNumber().nullable(),
  person: model.belongsTo(() => Person, { mappedBy: "addresses" }),
});

export default Address;

export type PersonAddress = InferTypeOf<typeof Address>;

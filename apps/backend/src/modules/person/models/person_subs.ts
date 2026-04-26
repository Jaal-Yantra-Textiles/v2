import { model } from "@medusajs/framework/utils";
import Person from "./person";

const PersonSub = model.define("person_subs", {
    id: model.id().primaryKey(),
    // ... your subscription-related fields, e.g.:
    subscription_type: model.enum(["email", "sms"]),
    network: model.enum(["cicilabel", "jaalyantra"]),
    subscription_status: model.enum(["active", "inactive"]),
    email_subscribed: model.text(),
    person: model.belongsTo(() => Person, { mappedBy: "subscribed" }),
  });

  export default PersonSub;
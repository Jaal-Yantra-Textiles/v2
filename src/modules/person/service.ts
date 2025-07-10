// src/modules/person/services/person-service.ts
import { MedusaError, MedusaService } from "@medusajs/framework/utils";
import Person from "../person/models/person";
import Address from "./models/person_address";
import ContactDetail from "./models/person_contact";
import Tag from "./models/person_tags";

class PersonService extends MedusaService({
  Person,
  Address,
  ContactDetail,
  Tag,
}) {
  // Custom methods can be added here
  //
  constructor() {
    super(...arguments)
  }

  async listPersonAddresses(...args) {
    return this.listAddresses(...args)
  }

}

export default PersonService;

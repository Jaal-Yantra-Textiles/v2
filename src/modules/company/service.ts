import { MedusaService } from "@medusajs/framework/utils";
import Company from "./models/company";

class CompanyService extends MedusaService({
  Company,
}) {
  constructor() {
    super(...arguments)
  }
}

export default CompanyService;

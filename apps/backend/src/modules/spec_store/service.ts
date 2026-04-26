import { MedusaService } from "@medusajs/framework/utils"
import SpecDoc from "./models/spec-doc"

class SpecStoreService extends MedusaService({
  SpecDoc,
}) {
  constructor() {
    super(...arguments)
  }
}

export default SpecStoreService

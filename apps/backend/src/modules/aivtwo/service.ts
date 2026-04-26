import { MedusaService } from "@medusajs/framework/utils"
import AiVtwoRun from "./models/ai-vtwo-run"

class AiVTwoService extends MedusaService({
  AiVtwoRun,
}) {
  constructor() {
    super(...arguments)
  }
}

export default AiVTwoService

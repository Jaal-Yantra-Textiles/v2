import { MedusaService } from "@medusajs/framework/utils"
import Partner from "./models/partner"
import PartnerAdmin from "./models/partner-admin"

class PartnerService extends MedusaService({
    Partner,
    PartnerAdmin,
}) {
    constructor() {
        super(...arguments)
    }    
    // Custom methods can be added here if needed
    // The basic CRUD operations are already provided by MedusaService

}

export default PartnerService

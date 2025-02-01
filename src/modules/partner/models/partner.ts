import { model } from "@medusajs/framework/utils"
import PartnerAdmin from "./partner-admin"


const Partner = model.define("partner", {
    id: model.id().primaryKey(),
    name: model.text().searchable(),
    handle: model.text().unique().searchable(),
    logo: model.text().nullable(),
    
    // Status and visibility
    status: model.enum(['active', 'inactive', 'pending'])
        .default('pending'),
    is_verified: model.boolean().default(false),
    
   
    // Relationships
    admins: model.hasMany(() => PartnerAdmin),
    
    // Metadata
    metadata: model.json().nullable()
})

export default Partner

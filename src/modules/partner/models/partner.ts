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

    // Workspace type — controls sidebar navigation and available features
    workspace_type: model.enum(['seller', 'manufacturer', 'individual'])
        .default('manufacturer'),

    // WhatsApp notifications
    whatsapp_number: model.text().nullable(),
    whatsapp_verified: model.boolean().default(false),

    // Storefront
    storefront_domain: model.text().nullable(),
    website_id: model.text().nullable(),
    vercel_project_id: model.text().nullable(),
    vercel_project_name: model.text().nullable(),

    // Relationships
    admins: model.hasMany(() => PartnerAdmin),

    // Metadata
    metadata: model.json().nullable()
})

export default Partner

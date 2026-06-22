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

    // Legal / billing identity — partner's own tax / GST / registration ID.
    // When null, invoice/label generation falls back to the platform (JYT/KHT)
    // tax ID so documents stay legally valid (see tax-id-lib.ts, issue #348).
    // Typed column (NOT metadata) because it is load-bearing for compliance.
    tax_id: model.text().nullable(),
    tax_id_type: model.text().nullable(), // e.g. "GSTIN", "VAT", "PAN"

    // Storefront
    storefront_domain: model.text().nullable(),
    website_id: model.text().nullable(),
    vercel_project_id: model.text().nullable(),
    vercel_project_name: model.text().nullable(),
    vercel_last_deployment_id: model.text().nullable(),
    vercel_linked: model.boolean().default(false),
    storefront_repo: model.text().nullable(),
    storefront_root_dir: model.text().nullable(),
    storefront_branch: model.text().nullable(),

    // Relationships
    admins: model.hasMany(() => PartnerAdmin),

    // Metadata
    metadata: model.json().nullable()
})

export default Partner

import { model } from "@medusajs/framework/utils"
import Partner from "./partner"

const PartnerAdmin = model.define("partner_admin", {
    id: model.id().primaryKey(),
    
    // Personal information
    first_name: model.text().searchable(),
    last_name: model.text().searchable(),
    email: model.text().unique().searchable(),
    phone: model.text().nullable(),
    
    // Authentication and status
    password_hash: model.text().nullable(),
    is_active: model.boolean().default(true),
    last_login: model.dateTime().nullable(),
    
    // Relationship with Partner
    partner: model.belongsTo(() => Partner, {
        mappedBy: "admins",
    }),
    
    // Role and permissions
    role: model.enum(['owner', 'admin', 'manager'])
        .default('admin'),
    permissions: model.json().nullable(),
    
    // Metadata
    metadata: model.json().nullable()
})

export default PartnerAdmin

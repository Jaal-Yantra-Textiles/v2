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

    // Workspace type — controls sidebar navigation and available features.
    // `designer` (#338/#958): a designer-persona partner who authors designs
    // (sketches → moodboard → fabric spec) and routes them to a producing
    // partner, rather than running the full commerce surface. Drives the lean
    // designer sidebar + the persona layout default (see partner-ui-prefs).
    workspace_type: model.enum(['seller', 'manufacturer', 'individual', 'designer'])
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

    // Billing locale — the partner's country and the currency their subscription
    // is charged in. Load-bearing (drives subscription payment-provider routing:
    // INR → PayU, everything else → Stripe), so typed columns NOT metadata.
    // Set during onboarding; the subscription route prefers these over the legacy
    // metadata.currency_code fallback.
    country_code: model.text().nullable(), // ISO-3166 alpha-2, e.g. "IN", "DE"
    currency_code: model.text().nullable(), // ISO-4217 lower, e.g. "inr", "eur"

    // Storefront
    storefront_domain: model.text().nullable(),
    // The partner's own connected custom domain (apex/primary form, e.g.
    // "hrhandloom.in"), distinct from `storefront_domain` (the provisioned
    // platform subdomain). Typed columns NOT metadata — load-bearing for the
    // domain status API, host resolution, and marketing-base derivation. The
    // www/apex twin is derived (see deriveDomainPair) and registered as a
    // `website_domain` alias; only the canonical host is stored here.
    custom_domain: model.text().nullable(),
    custom_domain_verified: model.boolean().default(false),
    website_id: model.text().nullable(),
    vercel_project_id: model.text().nullable(),
    vercel_project_name: model.text().nullable(),
    vercel_last_deployment_id: model.text().nullable(),
    vercel_linked: model.boolean().default(false),
    storefront_repo: model.text().nullable(),
    storefront_root_dir: model.text().nullable(),
    storefront_branch: model.text().nullable(),

    // Multi-provider hosting (#884 S3). Which provider/account a partner's
    // storefront was provisioned onto, and the provider-agnostic project ref.
    // `hosting_provider` null → treat as legacy "vercel" (see resolve-partner-
    // provider.ts). `deployment_account_id` null → legacy env-single-account
    // path. `deployment_project_id/name` supersede the vercel_* columns; the
    // vercel_* columns are kept for backwards-compat reads of pre-#884 records.
    hosting_provider: model.text().nullable(),
    deployment_account_id: model.text().nullable(),
    deployment_project_id: model.text().nullable(),
    deployment_project_name: model.text().nullable(),

    // Relationships
    admins: model.hasMany(() => PartnerAdmin),

    // Metadata
    metadata: model.json().nullable()
})

export default Partner

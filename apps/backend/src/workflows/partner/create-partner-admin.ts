import { 
    createStep,
    createWorkflow,
    StepResponse,
    transform,
    WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { 
    setAuthAppMetadataStep,
} from "@medusajs/medusa/core-flows"
import { PARTNER_MODULE } from "../../modules/partner"
import PartnerService from "../../modules/partner/service"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { randomBytes } from "crypto"
import type { IAuthModuleService } from "@medusajs/types"

export type CreatePartnerAdminWorkflowInput = {
    partner: {
        name: string
        handle?: string
        logo?: string
        status?: 'active' | 'inactive' | 'pending'
        is_verified?: boolean
        workspace_type?: 'seller' | 'manufacturer' | 'individual' | 'designer'
    }
    admin: {
        email: string
        first_name?: string
        last_name?: string
        phone?: string
        role?: 'owner' | 'admin' | 'manager'
    }
    authIdentityId: string
    tempPassword?: string
}

import Scrypt from "scrypt-kdf"

// ---- Handle derivation + pre-DB validation ---------------------------------
//
// `partner.handle` is a REQUIRED, UNIQUE column, and until now nothing on
// either create path derived it — the MCP tool advertised "auto-derived if
// omitted" while the workflow passed `undefined` straight to MikroORM, which
// answered `ValidationError: Value for Partner.handle is required` → 500
// (seen on prod, 2026-09-07: three 500s while the assistant created the JP
// Handloom partner). A dry-run rehearsed fine because it never touches the DB,
// which is exactly why the gap survived.
//
// The same story for `partner_admin.email`: unique column, no pre-write check,
// raw constraint error → 500. Both are validation questions and both belong
// BEFORE the first insert, not inside it.

/** Cap on the name-derived part of the handle. */
const HANDLE_SLUG_MAX = 48

/**
 * Slugify a partner name: lowercase, accents folded, runs of non-alphanumerics
 * collapsed to single dashes, dashes trimmed. Pure on purpose — unit-tested.
 */
export const slugifyPartnerName = (name: string): string =>
    (name ?? "")
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, HANDLE_SLUG_MAX)
        .replace(/-+$/g, "")

/**
 * The handle a partner gets when nobody supplied one: `partner_` + the name
 * slug. A name with no slug-able characters ("株式会社" transliterates to
 * nothing here) still yields a handle — a timestamp fallback rather than the
 * undefined that used to reach the database.
 */
export const derivePartnerHandle = (name: string): string => {
    const slug = slugifyPartnerName(name)
    return `partner_${slug || Date.now().toString(36)}`
}

/**
 * Resolve handle + admin email BEFORE any write.
 *
 * - an EXPLICIT handle is kept as-is (trimmed), but checked for uniqueness so
 *   the caller gets the same 422 the route always aimed at, instead of the
 *   raw unique-constraint 500 a race would otherwise surface
 * - an omitted/blank handle is derived from the name (`partner_<name-slug>`),
 *   suffixed -2, -3, … until free
 * - the admin email is checked against partner_admins for the same reason:
 *   the unique column is a validation question, not a post-insert surprise
 */
const resolvePartnerIdentityStep = createStep(
    "resolve-partner-handle-and-validate-admin",
    async (
        input: { name: string; handle?: string; admin_email: string },
        { container }
    ) => {
        const partnerService: PartnerService = container.resolve(PARTNER_MODULE)

        let handle: string
        const explicit = (input.handle ?? "").trim()

        if (explicit) {
            const taken = await partnerService.listPartners({ handle: explicit })
            if (taken?.length) {
                throw new MedusaError(
                    MedusaError.Types.DUPLICATE_ERROR,
                    `A partner with handle "${explicit}" already exists. Please use a unique handle.`
                )
            }
            handle = explicit
        } else {
            const base = derivePartnerHandle(input.name)
            handle = base
            for (let i = 2; i < 52; i++) {
                const taken = await partnerService.listPartners({ handle })
                if (!taken?.length) break
                handle = `${base}-${i}`
            }
            // Everything from -2 to -51 taken: same name created 50 times.
            // Fall through with a unique-enough suffix rather than failing.
            if ((await partnerService.listPartners({ handle })).length) {
                handle = `${base}-${Date.now().toString(36)}`
            }
        }

        const email = (input.admin_email ?? "").trim()
        if (!email) {
            throw new MedusaError(
                MedusaError.Types.INVALID_DATA,
                "Admin email is required."
            )
        }
        const existingAdmin = await partnerService.listPartnerAdmins({ email })
        if (existingAdmin?.length) {
            throw new MedusaError(
                MedusaError.Types.DUPLICATE_ERROR,
                `A partner admin with email "${email}" already exists. Please use a different email.`
            )
        }

        return new StepResponse({ handle })
    }
)

const createPartnerAndAdminStep = createStep(
    "create-partner-and-admin-step",
    async ({ 
        partner: partnerData,
        admin: adminData,
    }: Omit<CreatePartnerAdminWorkflowInput, "authIdentityId">, 
    { container }) => {
        const partnerService: PartnerService = container.resolve(PARTNER_MODULE)
        // Create partner
        let createdPartner: any
        try {
            createdPartner = await partnerService.createPartners(partnerData)
        } catch (err: any) {
            if (err.message?.includes?.("already exists")) {
                throw new MedusaError(
                    MedusaError.Types.DUPLICATE_ERROR,
                    `A partner with handle "${partnerData.handle}" already exists. Please use a unique handle.`
                )
            }
            throw err
        }
        
        // Create partner admin
        const partnerAdmin = await partnerService.createPartnerAdmins({
            ...adminData,
            partner_id: createdPartner.id
        })
        const partnerWithAdmin = {
            createdPartner, 
            partnerAdmin
        }
        return new StepResponse(partnerWithAdmin, {
            partner: partnerWithAdmin.createdPartner,
            partnerAdmin: partnerWithAdmin.partnerAdmin
        })
    },
    async (partnerWithAdmin, { container }) => {
        const partnerService: PartnerService = container.resolve(PARTNER_MODULE)
        if (partnerWithAdmin) {
            await partnerService.deletePartnerAdmins(partnerWithAdmin.partnerAdmin.id)
            await partnerService.deletePartners(partnerWithAdmin.partner.id)
        }
    }
)

/**
 * Bypass email verification for a partner's auth identity by upserting a
 * verified auth_verification row. Uses the same logic as
 * backfillPartnerEmailVerifiedJob so login does not return
 * verification_required.
 */
const verifyPartnerAuthEmailStep = createStep(
    "verify-partner-auth-email",
    async (
        input: { authIdentityId: string; email: string },
        { container }
    ) => {
        const authModule = container.resolve(Modules.AUTH) as any

        // Determine entity type from config (same as backfill job)
        let entityType = "email"
        try {
            // `: any` because Medusa 2.19 types this resolve as `{}`. The read
            // below is already fully optional-chained inside a try/catch.
            const config: any = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE)
            const forPartner =
                config?.projectConfig?.http?.authVerificationsPerActor?.partner
            const emailpass = (forPartner || []).find(
                (v: any) => v?.auth_provider === "emailpass"
            )
            if (emailpass?.entity_type) entityType = emailpass.entity_type
        } catch { /* default to "email" */ }

        const existing = await authModule.listAuthVerifications({
            auth_identity_id: input.authIdentityId,
            entity_id: input.email,
            entity_type: entityType,
        } as any)

        const row = existing?.[0] as any
        const now = new Date()

        if (row) {
            if (row.verified_at) {
                return new StepResponse(null) // already verified
            }
            await authModule.updateAuthVerifications({
                id: row.id,
                verified_at: now,
            } as any)
            return new StepResponse(null)
        }

        await authModule.createAuthVerifications([{
            auth_identity_id: input.authIdentityId,
            entity_id: input.email,
            entity_type: entityType,
            code_provider: "emailpass",
            requested_at: now,
            verified_at: now,
        }] as any)

        return new StepResponse(null)
    }
)

// External workflow: requires authIdentityId
const createPartnerAdminWorkflow = createWorkflow(
    "create-partner-admin",
    (input: CreatePartnerAdminWorkflowInput) => {
        // Validation BEFORE the first insert: handle derivation + uniqueness,
        // admin email uniqueness. A 422 here costs one read; a raw MikroORM
        // constraint error after a partial write costs a 500 and a rollback.
        const identity = resolvePartnerIdentityStep({
            name: input.partner.name,
            handle: input.partner.handle,
            admin_email: input.admin.email,
        })

        const partnerInput = transform({ input, identity }, ({ input, identity }) => ({
            partner: { ...input.partner, handle: identity.handle },
            admin: input.admin,
        }))

        const partnerWithAdmin = createPartnerAndAdminStep(partnerInput)

        setAuthAppMetadataStep({
            authIdentityId: input.authIdentityId,
            actorType: "partner",
            value: partnerWithAdmin.createdPartner.id,  // Use partner ID, not admin ID
        })

        verifyPartnerAuthEmailStep({
            authIdentityId: input.authIdentityId,
            email: input.admin.email,
        })

        return new WorkflowResponse(
            partnerWithAdmin
        )
    }
)

// Internal workflow: registers auth via provider and then sets app metadata
export type CreatePartnerAdminWithRegistrationInput = Omit<CreatePartnerAdminWorkflowInput, "authIdentityId">

const registerPartnerAdminAuthStep = createStep(
    "register-partner-admin-auth-step",
    async (
        input: { email: string; tempPassword?: string },
        { container }
    ) => {
        const hashConfig = { logN: 15, r: 8, p: 1 }
        // Generate or reuse the provided plain password
        const plainPassword = input.tempPassword || randomBytes(12).toString("base64")
        // Hash the exact password we will return to caller
        const hashed = await Scrypt.kdf(Buffer.from(plainPassword), hashConfig)

        const authModule = container.resolve(Modules.AUTH) as IAuthModuleService
        const reg = await authModule.createAuthIdentities({
            provider_identities: [
                {
                    provider: "emailpass",
                    // emailpass provider expects entity_id to be the email identifier
                    entity_id: input.email,
                    provider_metadata: {
                        password: hashed.toString("base64"),
                    },
                },
            ],
        })
        return new StepResponse({ authIdentityId: reg.id, tempPassword: plainPassword })
    }
)

export const createPartnerAdminWithRegistrationWorkflow = createWorkflow(
    "create-partner-admin-with-registration",
    (input: CreatePartnerAdminWithRegistrationInput) => {
        // Same pre-write validation as the self-registration twin: derive the
        // handle, refuse duplicates — as 422s, never constraint-error 500s.
        const identity = resolvePartnerIdentityStep({
            name: input.partner.name,
            handle: input.partner.handle,
            admin_email: input.admin.email,
        })

        const partnerInput = transform({ input, identity }, ({ input, identity }) => ({
            partner: { ...input.partner, handle: identity.handle },
            admin: input.admin,
        }))

        const partnerWithAdmin = createPartnerAndAdminStep(partnerInput)

        const registered = registerPartnerAdminAuthStep({
            email: input.admin.email,
            tempPassword: input.tempPassword,
        })

        setAuthAppMetadataStep({
            authIdentityId: registered.authIdentityId,
            actorType: "partner",
            value: partnerWithAdmin.createdPartner.id,  // Use partner ID, not admin ID
        })

        verifyPartnerAuthEmailStep({
            authIdentityId: registered.authIdentityId,
            email: input.admin.email,
        })

        return new WorkflowResponse({
            partnerWithAdmin,
            registered
        })
    }
)

export default createPartnerAdminWorkflow

import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { setAuthAppMetadataStep } from "@medusajs/medusa/core-flows"
import { INVESTOR_MODULE } from "../../modules/investor"
import InvestorService from "../../modules/investor/service"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { randomBytes } from "crypto"
import type { IAuthModuleService } from "@medusajs/types"
import Scrypt from "scrypt-kdf"

export type CreateInvestorAdminWorkflowInput = {
  investor: {
    name: string
    handle?: string
    logo?: string
    email: string
    status?: "active" | "inactive" | "pending"
    is_verified?: boolean
    investor_type?: "individual" | "entity" | "fund"
    legal_name?: string
    tax_id?: string
    country_code?: string
    currency_code?: string
  }
  admin: {
    email: string
    first_name?: string
    last_name?: string
    phone?: string
    role?: "owner" | "admin" | "viewer"
  }
  authIdentityId: string
  tempPassword?: string
}

const createInvestorAndAdminStep = createStep(
  "create-investor-and-admin-step",
  async (
    {
      investor: investorData,
      admin: adminData,
    }: Omit<CreateInvestorAdminWorkflowInput, "authIdentityId">,
    { container }
  ) => {
    const investorService: InvestorService = container.resolve(INVESTOR_MODULE)
    let createdInvestor: any
    try {
      createdInvestor = await investorService.createInvestors(investorData)
    } catch (err: any) {
      if (err.message?.includes?.("already exists")) {
        throw new MedusaError(
          MedusaError.Types.DUPLICATE_ERROR,
          `An investor with handle "${investorData.handle}" already exists.`
        )
      }
      throw err
    }

    const investorAdmin = await investorService.createInvestorAdmins({
      first_name: adminData.first_name ?? "",
      last_name: adminData.last_name ?? "",
      email: adminData.email,
      phone: adminData.phone,
      role: adminData.role,
      investor_id: createdInvestor.id,
    })

    return new StepResponse(
      { createdInvestor, investorAdmin },
      { investor: createdInvestor, investorAdmin }
    )
  },
  async (investorWithAdmin, { container }) => {
    const investorService: InvestorService = container.resolve(INVESTOR_MODULE)
    if (investorWithAdmin) {
      await investorService.deleteInvestorAdmins(investorWithAdmin.investorAdmin.id)
      await investorService.deleteInvestors(investorWithAdmin.investor.id)
    }
  }
)

const createInvestorAdminWorkflow = createWorkflow(
  "create-investor-admin",
  (input: CreateInvestorAdminWorkflowInput) => {
    const investorWithAdmin = createInvestorAndAdminStep({
      investor: input.investor,
      admin: input.admin,
    })

    setAuthAppMetadataStep({
      authIdentityId: input.authIdentityId,
      actorType: "investor",
      value: investorWithAdmin.createdInvestor.id,
    })

    return new WorkflowResponse(investorWithAdmin)
  }
)

export type CreateInvestorAdminWithRegistrationInput = Omit<
  CreateInvestorAdminWorkflowInput,
  "authIdentityId"
>

const hashPassword = async (plain: string) => {
  const hashConfig = { logN: 15, r: 8, p: 1 }
  const hashed = await Scrypt.kdf(Buffer.from(plain), hashConfig)
  return hashed.toString("base64")
}

// Find the existing emailpass provider identity for an email (Medusa v2 keys it by
// entity_id = email). Returns undefined if this email has never authenticated.
const findEmailpassIdentity = async (
  authModule: IAuthModuleService,
  email: string
) => {
  const identities = await authModule.listProviderIdentities({
    entity_id: email,
  } as any)
  return (identities || []).find((pi: any) => pi.provider === "emailpass")
}

const registerInvestorAdminAuthStep = createStep(
  "register-investor-admin-auth-step",
  async (input: { email: string; tempPassword?: string }, { container }) => {
    const plainPassword = input.tempPassword || randomBytes(12).toString("base64")
    const passwordHash = await hashPassword(plainPassword)

    const authModule = container.resolve(Modules.AUTH) as IAuthModuleService

    // If an emailpass identity already exists for this email (e.g. the person is
    // already a partner/user, or a prior invite half-completed), don't fail with
    // "auth already exists" — regenerate its password so this invite doubles as a
    // password reset. setAuthAppMetadataStep then adds the investor actor mapping
    // (it's keyed per actor type, so any existing partner/user mapping is kept).
    const existing = await findEmailpassIdentity(authModule, input.email)
    if (existing) {
      const previousProviderMetadata = existing.provider_metadata || {}
      await authModule.updateProviderIdentities({
        id: existing.id,
        provider_metadata: { ...previousProviderMetadata, password: passwordHash },
      } as any)
      return new StepResponse(
        { authIdentityId: existing.auth_identity_id, tempPassword: plainPassword, reused: true },
        {
          mode: "reset" as const,
          providerIdentityId: existing.id,
          previousProviderMetadata,
        }
      )
    }

    const reg = await authModule.createAuthIdentities({
      provider_identities: [
        {
          provider: "emailpass",
          entity_id: input.email,
          provider_metadata: { password: passwordHash },
        },
      ],
    })
    return new StepResponse(
      { authIdentityId: reg.id, tempPassword: plainPassword, reused: false },
      { mode: "create" as const, authIdentityId: reg.id }
    )
  },
  async (rollback, { container }) => {
    if (!rollback) return
    const authModule = container.resolve(Modules.AUTH) as IAuthModuleService
    if (rollback.mode === "reset" && rollback.providerIdentityId) {
      // Restore the previous password (don't delete an identity we didn't create).
      await authModule.updateProviderIdentities({
        id: rollback.providerIdentityId,
        provider_metadata: rollback.previousProviderMetadata,
      } as any)
    } else if (rollback.mode === "create" && rollback.authIdentityId) {
      await authModule.deleteAuthIdentities([rollback.authIdentityId])
    }
  }
)

// Reset (regenerate) an existing investor's emailpass password — used by the
// admin re-invite path when the investor already exists in the system.
export const resetInvestorAdminAuthStep = createStep(
  "reset-investor-admin-auth-step",
  async (input: { email: string; tempPassword?: string }, { container }) => {
    const authModule = container.resolve(Modules.AUTH) as IAuthModuleService
    const existing = await findEmailpassIdentity(authModule, input.email)
    if (!existing) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `No emailpass auth identity found for ${input.email}`
      )
    }

    const plainPassword = input.tempPassword || randomBytes(12).toString("base64")
    const passwordHash = await hashPassword(plainPassword)
    const previousProviderMetadata = existing.provider_metadata || {}

    await authModule.updateProviderIdentities({
      id: existing.id,
      provider_metadata: { ...previousProviderMetadata, password: passwordHash },
    } as any)

    return new StepResponse(
      { authIdentityId: existing.auth_identity_id, tempPassword: plainPassword },
      { providerIdentityId: existing.id, previousProviderMetadata }
    )
  },
  async (rollback, { container }) => {
    if (!rollback?.providerIdentityId) return
    const authModule = container.resolve(Modules.AUTH) as IAuthModuleService
    await authModule.updateProviderIdentities({
      id: rollback.providerIdentityId,
      provider_metadata: rollback.previousProviderMetadata,
    } as any)
  }
)

export const resetInvestorAdminPasswordWorkflow = createWorkflow(
  "reset-investor-admin-password",
  (input: { email: string; tempPassword?: string }) => {
    const reset = resetInvestorAdminAuthStep(input)
    return new WorkflowResponse(reset)
  }
)

export const createInvestorAdminWithRegistrationWorkflow = createWorkflow(
  "create-investor-admin-with-registration",
  (input: CreateInvestorAdminWithRegistrationInput) => {
    const investorWithAdmin = createInvestorAndAdminStep({
      investor: input.investor,
      admin: input.admin,
    })

    const registered = registerInvestorAdminAuthStep({
      email: input.admin.email,
      tempPassword: input.tempPassword,
    })

    setAuthAppMetadataStep({
      authIdentityId: registered.authIdentityId,
      actorType: "investor",
      value: investorWithAdmin.createdInvestor.id,
    })

    return new WorkflowResponse({ investorWithAdmin, registered })
  }
)

export default createInvestorAdminWorkflow

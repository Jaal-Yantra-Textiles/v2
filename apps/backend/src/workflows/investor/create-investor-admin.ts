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

const registerInvestorAdminAuthStep = createStep(
  "register-investor-admin-auth-step",
  async (input: { email: string; tempPassword?: string }, { container }) => {
    const hashConfig = { logN: 15, r: 8, p: 1 }
    const plainPassword = input.tempPassword || randomBytes(12).toString("base64")
    const hashed = await Scrypt.kdf(Buffer.from(plainPassword), hashConfig)

    const authModule = container.resolve(Modules.AUTH) as IAuthModuleService
    const reg = await authModule.createAuthIdentities({
      provider_identities: [
        {
          provider: "emailpass",
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

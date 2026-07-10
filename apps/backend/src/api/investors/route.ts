import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

// Investor self-registration is DISABLED. Onboarding is invite-only: a platform
// admin provisions the account via `POST /admin/investors`, which emails the
// investor their username + temp password. Prospective investors use
// `POST /investors/access-requests` to request access ("we'll reach out").
export const POST = async (
  _req: AuthenticatedMedusaRequest,
  _res: MedusaResponse
) => {
  throw new MedusaError(
    MedusaError.Types.NOT_ALLOWED,
    "Investor self-registration is disabled. Request access and an admin will provision your account."
  )
}

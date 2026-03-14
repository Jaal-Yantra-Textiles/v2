import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import {
  updateProductTypesWorkflow,
  deleteProductTypesWorkflow,
} from "@medusajs/medusa/core-flows"
import { getPartnerFromAuthContext } from "../../helpers"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner associated with this account"
    )
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product_types",
    fields: ["*"],
    filters: { id: req.params.id },
  })

  if (!data?.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Product type not found"
    )
  }

  res.json({ product_type: data[0] })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner associated with this account"
    )
  }

  const { result } = await updateProductTypesWorkflow(req.scope).run({
    input: {
      selector: { id: req.params.id },
      update: req.body as any,
    },
  })

  res.json({ product_type: result[0] })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner associated with this account"
    )
  }

  await deleteProductTypesWorkflow(req.scope).run({
    input: [req.params.id],
  })

  res.status(200).json({ id: req.params.id, object: "product_type", deleted: true })
}

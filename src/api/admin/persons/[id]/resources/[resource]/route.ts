import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/utils"
import { getPersonResourceDefinition } from "../../../resources/registry"

const resolveResourceOrThrow = (resourceKey: string) => {
  const resource = getPersonResourceDefinition(resourceKey)

  if (!resource) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Unsupported person resource "${resourceKey}"`
    )
  }

  return resource
}

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse,
) => {
  const { id: personId, resource: resourceKey } = req.params
  const resource = resolveResourceOrThrow(resourceKey)

  if (!resource.handlers.list) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Listing is not supported for resource "${resourceKey}"`,
    )
  }

  const result = await resource.handlers.list({
    scope: req.scope,
    personId,
    query: req.query,
  })

  res.status(200).json({
    [resource.listKey]: result.items,
    count: result.count,
  })
}

export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse,
) => {
  const { id: personId, resource: resourceKey } = req.params
  const resource = resolveResourceOrThrow(resourceKey)

  if (!resource.handlers.create) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Creation is not supported for resource "${resourceKey}"`,
    )
  }

  const payload = resource.validators?.create
    ? resource.validators.create.parse(req.body)
    : req.body

  const created = await resource.handlers.create({
    scope: req.scope,
    personId,
    payload,
  })

  res.status(201).json({
    [resource.itemKey]: created,
  })
}

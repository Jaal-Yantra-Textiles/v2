import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { createCollectionsWorkflow } from "@medusajs/medusa/core-flows"
import { getPartnerStore, tryGetPartnerStore } from "../helpers"

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

// Collection handles are globally unique in Medusa. Partners share that
// namespace, so two partners would otherwise collide on common titles like
// "Summer 2026". Scope every partner-created handle with a short slug from
// the store id so each partner gets its own subspace.
const buildPartnerCollectionHandle = (
  storeId: string,
  userHandle: string | undefined,
  title: string
) => {
  const storeSuffix = storeId.slice(-6).toLowerCase()
  const base = slugify(userHandle?.trim() ? userHandle : title)
  return `s-${storeSuffix}-${base}`
}

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await tryGetPartnerStore(req.auth_context, req.scope)
  if (!store) {
    return res.json({ collections: [], count: 0, offset: 0, limit: 20 })
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: storeData } = await query.graph({
    entity: "stores",
    fields: ["product_collections.id"],
    filters: { id: store.id },
  })

  const linkedIds = ((storeData?.[0] as any)?.product_collections || []).map(
    (c: any) => c.id
  )

  if (!linkedIds.length) {
    return res.json({ collections: [], count: 0, offset: 0, limit: 20 })
  }

  const { data: collections } = await query.graph({
    entity: "product_collection",
    fields: ["id", "title", "handle", "metadata", "created_at", "updated_at", "products.*"],
    filters: { id: linkedIds },
  })

  res.json({
    collections: collections || [],
    count: collections?.length || 0,
    offset: 0,
    limit: 20,
  })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await getPartnerStore(req.auth_context, req.scope)

  const body = (req.body ?? {}) as {
    title?: string
    handle?: string
    metadata?: Record<string, unknown>
  }

  if (!body.title || typeof body.title !== "string" || !body.title.trim()) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "title is required")
  }

  const scopedHandle = buildPartnerCollectionHandle(
    store.id,
    body.handle,
    body.title
  )

  const { result } = await createCollectionsWorkflow(req.scope).run({
    input: {
      collections: [
        {
          ...body,
          title: body.title.trim(),
          handle: scopedHandle,
        } as any,
      ],
    },
  })

  const collection = result[0]

  // Link collection to store
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any
  await remoteLink.create({
    [Modules.STORE]: { store_id: store.id },
    [Modules.PRODUCT]: { product_collection_id: collection.id },
  })

  res.status(201).json({ collection })
}

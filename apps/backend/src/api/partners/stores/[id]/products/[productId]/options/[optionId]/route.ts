import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { setProductProductOptionsWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerStoreAccess } from "../../../../../../helpers"
import {
  listProductOptions,
  normalizeTitle,
  normalizeValueEntries,
  resolveCuratedValueIds,
} from "../shared"

/**
 * Resolve the option and prove it belongs to THIS product.
 *
 * Both writes below used to take `req.params.optionId` straight to the module
 * service, which validated the store in the URL and then happily wrote to any
 * option id in the database — the #1404 shape. Since 2.16 an option can be
 * shared, so an unchecked DELETE could strip an option off another tenant's
 * product. Validate both ends.
 */
const resolveOption = async (
  scope: any,
  productId: string,
  optionId: string
) => {
  const option = (await listProductOptions(scope, productId)).find(
    (o) => o.id === optionId
  )

  if (!option) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Option ${optionId} is not an option of product ${productId}.`
    )
  }

  return option
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerStoreAccess(req.auth_context, req.params.id, req.scope)

  const productId = req.params.productId
  const optionId = req.params.optionId
  const body = req.body as Record<string, any>
  const option = await resolveOption(req.scope, productId, optionId)

  const productService: any = req.scope.resolve(Modules.PRODUCT)
  const [optionRow] = await productService.listProductOptions(
    { id: optionId },
    { relations: ["values"] }
  )
  const isCurated = optionRow?.is_exclusive === false

  const title = normalizeTitle(body.title)
  if (title && title !== option.title) {
    // 🔑 A curated option is ONE row shared by every partner that links it.
    // Renaming it here would rename Colour across the whole platform from
    // inside one partner's product page — a single-tenant action with a
    // platform-wide blast radius, and nothing in the response would say so.
    if (isCurated) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `"${option.title}" is a shared option and cannot be renamed from a product. Choose which of its values this product offers instead.`
      )
    }
    await productService.updateProductOptions(optionId, { title })
  }

  // 🔑 The values a product can use live on `product_product_option_value`,
  // NOT on the option. Writing `values` through the module service updated the
  // option row and returned it in full — a 200 whose body showed the new value
  // while the product still showed the old list. That response is what made the
  // partner's save button look like it did nothing: it reported success, the
  // refetch showed no change, and nothing was ever logged.
  if (body.values !== undefined) {
    const entries = normalizeValueEntries(body.values)
    const desired = entries.map((e) => e.value)
    const onProduct = new Map(option.values.map((v) => [v.value, v.id]))
    const ownedValues = (optionRow?.values ?? []) as any[]
    const wantedEntries = entries.filter((e) => !onProduct.has(e.value))
    const wanted = wantedEntries.map((e) => e.value)

    // On a curated option a partner selects from the palette (or adds one of
    // their own with a hex); on their own option they author freely.
    const add = isCurated
      ? await resolveCuratedValueIds(
          req.scope,
          { id: optionId, title: option.title, values: ownedValues },
          wantedEntries,
          (req.auth_context as any)?.app_metadata?.partner_id
        )
      : wanted.map((value) => {
          const owned = ownedValues.find((v) => v.value === value)
          return owned ? owned.id : { value }
        })

    const desiredSet = new Set(desired)
    const remove = option.values
      .filter((v) => !desiredSet.has(v.value))
      .map((v) => v.id)

    if (add.length || remove.length) {
      // Core refuses to drop a value a variant still uses, which is the
      // refusal the partner should see rather than a silent no-op.
      await setProductProductOptionsWorkflow(req.scope).run({
        input: {
          product_id: productId,
          update: [{ product_option_id: optionId, add, remove }],
        } as any,
      })
    }
  }

  const product_option = (await listProductOptions(req.scope, productId)).find(
    (o) => o.id === optionId
  )

  res.json({ product_option })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerStoreAccess(req.auth_context, req.params.id, req.scope)

  const productId = req.params.productId
  const optionId = req.params.optionId
  await resolveOption(req.scope, productId, optionId)

  // Unlink rather than hard-delete. `deleteProductOptionsWorkflow` removes the
  // option row itself, which for a shared option would take it off every other
  // product that carries it. Core garbage-collects an exclusive option once it
  // is no longer associated with any product, so this is still a delete for
  // everything a partner can author.
  await setProductProductOptionsWorkflow(req.scope).run({
    input: { product_id: productId, remove: [optionId] } as any,
  })

  res.json({ id: optionId, object: "product_option", deleted: true })
}

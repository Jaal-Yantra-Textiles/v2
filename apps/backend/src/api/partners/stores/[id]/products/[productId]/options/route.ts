import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import {
  createAndLinkProductOptionsToProductWorkflow,
  setProductProductOptionsWorkflow,
} from "@medusajs/medusa/core-flows"
import { validatePartnerStoreAccess } from "../../../../../helpers"
import {
  findCuratedOption,
  listProductOptions,
  normalizeTitle,
  normalizeValueEntries,
  resolveCuratedValueIds,
  titlesMatch,
} from "./shared"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerStoreAccess(req.auth_context, req.params.id, req.scope)

  const body = req.body as Record<string, any>
  const productId = req.params.productId
  const title = normalizeTitle(body.title)
  const entries = normalizeValueEntries(body.values)
  const values = entries.map((e) => e.value)
  const partnerId = (req.auth_context as any)?.app_metadata?.partner_id

  if (!title) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "An option needs a title."
    )
  }

  const existing = (await listProductOptions(req.scope, productId)).find((o) =>
    titlesMatch(o.title, title)
  )

  // Re-adding an option the product already has is a merge, not a collision.
  // The assistant reaches for `add_product_option` whenever it wants a value
  // to exist; answering 400 taught it to give up and try to create the variant
  // instead, which is the 400 the partner actually saw. Matching on
  // (product, title) — never on the global title — keeps a partner's product
  // from being bound to a row another tenant is also on.
  if (existing) {
    const productService: any = req.scope.resolve(Modules.PRODUCT)
    const [optionRow] = await productService.listProductOptions(
      { id: existing.id },
      { relations: ["values"] }
    )
    const ownedValues = (optionRow?.values ?? []) as any[]
    const onProduct = new Set(existing.values.map((v) => v.value))
    const wantedEntries = entries.filter((e) => !onProduct.has(e.value))
    const wanted = wantedEntries.map((e) => e.value)

    // On a curated (shared) option a partner selects from the palette, or adds
    // a colour of their own by supplying a hex — never renames, and never
    // silently widens the vocabulary for everyone else.
    const add = optionRow?.is_exclusive === false
      ? await resolveCuratedValueIds(
          req.scope,
          { id: existing.id, title: existing.title, values: ownedValues },
          wantedEntries,
          partnerId
        )
      : wanted.map((value) => {
          // The option may already own the value while the product's subset
          // does not — attach by id rather than minting a duplicate row.
          const owned = ownedValues.find((v) => v.value === value)
          return owned ? owned.id : { value }
        })

    if (add.length) {
      await setProductProductOptionsWorkflow(req.scope).run({
        input: {
          product_id: productId,
          update: [{ product_option_id: existing.id, add }],
        } as any,
      })
    }

    const [product_option] = (
      await listProductOptions(req.scope, productId)
    ).filter((o) => o.id === existing.id)

    res.json({ product_option, reused: true, added: add.length })
    return
  }

  // Colour is a vocabulary every partner draws from, so it is one shared row
  // that products LINK with their own value subset — not a per-product option
  // each partner re-invents. The subset lives on `product_product_option_value`,
  // and core refuses a variant that names a value outside it, so sharing the
  // row does not share the selections.
  const curated = await findCuratedOption(req.scope, title)

  if (curated) {
    const valueIds = await resolveCuratedValueIds(
      req.scope,
      curated,
      entries,
      partnerId
    )

    // ⚠️ Omitting `product_option_value_ids` links EVERY value on the option —
    // all 55 colours onto a product that asked for two.
    await setProductProductOptionsWorkflow(req.scope).run({
      input: {
        product_id: productId,
        add: [
          {
            product_option_id: curated.id,
            product_option_value_ids: valueIds,
          },
        ],
      } as any,
    })
  } else {
    await createAndLinkProductOptionsToProductWorkflow(req.scope).run({
      input: {
        product_id: productId,
        add: [{ title, values, is_exclusive: true }],
      } as any,
    })
  }

  const product_option = (await listProductOptions(req.scope, productId)).find(
    (o) => titlesMatch(o.title, title)
  )

  if (!product_option) {
    // The workflow answered without throwing but the product does not carry
    // the option — the exact silent failure this route shipped for months.
    // Refuse loudly rather than hand back another convincing 201.
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Option "${title}" was created but is not linked to product ${productId}.`
    )
  }

  res.status(201).json({ product_option })
}

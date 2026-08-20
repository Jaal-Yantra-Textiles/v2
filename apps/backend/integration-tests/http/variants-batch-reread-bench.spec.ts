import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { batchProductVariantsWorkflow } from "@medusajs/medusa/core-flows"
import { refetchBatchVariants } from "@medusajs/medusa/api/admin/products/helpers"

jest.setTimeout(600000)

/**
 * #1370 Open 2 — groundwork bench for the variants/batch re-read.
 *
 * On prod the re-read is 97-98% of the save. #1374 swapped the hand-rolled
 * version for core's `refetchBatchVariants` and it got WORSE (n=9: 15094ms ->
 * 36519/49610ms; n=2: 327ms -> 14292ms), while an admin GET of the same rows
 * with the same expansion returns in 0.6s.
 *
 * That fix changed three things at once, so a win would not have isolated
 * anything — and it did not win. Two variables are left:
 *
 *   engine : OLD query.graph + wide fields   vs  NEW remoteQuery + explicit fields
 *   scope  : the scope that JUST performed the write  vs  a fresh scope
 *
 * This runs the full 2x2 rather than one more end-to-end timing, because the
 * whole difficulty on prod has been that every measurement moved more than one
 * thing. It asserts almost nothing; it prints a table.
 */

// Exactly the field list the pre-#1374 route used (a27ac5f39^).
const OLD_FIELDS = [
  "*",
  "product_id",
  "price_set.prices.*",
  "price_set.prices.price_rules.*",
  "options.*",
  "options.option.*",
  "inventory_items.*",
]

// Exactly the list the current route hands to refetchBatchVariants.
const NEW_FIELDS = [
  "id", "title", "sku", "barcode", "ean", "upc", "allow_backorder",
  "manage_inventory", "hs_code", "origin_country", "mid_code", "material",
  "weight", "length", "height", "width", "metadata", "variant_rank",
  "product_id", "created_at", "updated_at", "*options",
  "price_set.prices.*",
  "price_set.prices.price_rules.value",
  "price_set.prices.price_rules.attribute",
]

const CURRENCIES = ["usd", "eur", "aud", "inr", "idr", "ils"]

const ms = async (fn: () => Promise<any>): Promise<[number, number]> => {
  const t = Date.now()
  const out = await fn()
  const rows = Array.isArray(out) ? out.length : (out?.updated?.length ?? 0)
  return [Date.now() - t, rows]
}

setupSharedTestSuite(() => {
  describe("variants/batch re-read — engine x scope bench", () => {
    const { api, getContainer } = getSharedTestEnv()

    let auth: any
    let productId: string
    let variantIds: string[] = []

    beforeAll(async () => {
      await createAdminUser(getContainer())
      auth = await getAuthHeaders(api)

      // 3 options x 3 values = 9 variants, mirroring the prod product
      // (prod_01M0A4N30MEBF1FBVBB5RTDHZR) that produced the 15094ms sample.
      const values = ["a", "b", "c"]
      const variants = values.flatMap((thread) =>
        values.map((colour) => ({
          title: `${thread}-${colour}`,
          sku: `bench-${thread}-${colour}-${Date.now()}`,
          manage_inventory: false,
          options: { Thread: thread, Colour: colour },
          prices: CURRENCIES.map((c, i) => ({
            currency_code: c,
            amount: 1000 + i,
          })),
        }))
      )

      const res = await api.post(
        "/admin/products",
        {
          title: `Bench product ${Date.now()}`,
          status: "draft",
          options: [
            { title: "Thread", values },
            { title: "Colour", values },
          ],
          variants,
        },
        auth
      )
      productId = res.data.product.id
      variantIds = res.data.product.variants.map((v: any) => v.id)
      expect(variantIds).toHaveLength(9)
    })

    it("times both engines, on a post-write scope and a fresh scope", async () => {
      const root = getContainer()

      // The update payload the partner UI sends: every variant, every price.
      const update = variantIds.map((id) => ({
        id,
        product_id: productId,
        prices: CURRENCIES.map((c, i) => ({
          currency_code: c,
          amount: 1000 + i,
        })),
      }))

      // --- A scope that has JUST performed the write -------------------------
      const writeScope: any = (root as any).createScope()
      const { result } = await batchProductVariantsWorkflow(writeScope).run({
        input: { update },
      })
      const batchResult = {
        created: result.created ?? [],
        updated: result.updated ?? [],
        deleted: result.deleted ?? [],
      }
      const ids = batchResult.updated.map((v: any) => v.id)

      const oldRead = (scope: any) =>
        scope
          .resolve(ContainerRegistrationKeys.QUERY)
          .graph({
            entity: "product_variants",
            fields: OLD_FIELDS,
            filters: { id: ids },
          })
          .then((r: any) => r.data)

      const newRead = (scope: any) =>
        refetchBatchVariants(batchResult as any, scope, NEW_FIELDS)

      const [postOld, rOldP] = await ms(() => oldRead(writeScope))
      const [postNew, rNewP] = await ms(() => newRead(writeScope))

      // --- A scope that has not written anything -----------------------------
      const freshA: any = (root as any).createScope()
      const [freshOld, rOldF] = await ms(() => oldRead(freshA))
      const freshB: any = (root as any).createScope()
      const [freshNew, rNewF] = await ms(() => newRead(freshB))

      // Second pass on fresh scopes — warm caches, guards against first-call cost.
      const freshC: any = (root as any).createScope()
      const [freshOld2] = await ms(() => oldRead(freshC))
      const freshD: any = (root as any).createScope()
      const [freshNew2] = await ms(() => newRead(freshD))

      /* eslint-disable no-console */
      console.log(`
=========== variants/batch re-read bench (n=9, ${CURRENCIES.length} currencies) ===========

                        | post-write scope | fresh scope | fresh (2nd)
  OLD query.graph+wide  | ${String(postOld).padStart(13)}ms | ${String(freshOld).padStart(8)}ms | ${String(freshOld2).padStart(8)}ms
  NEW remoteQuery+expl. | ${String(postNew).padStart(13)}ms | ${String(freshNew).padStart(8)}ms | ${String(freshNew2).padStart(8)}ms

  rows returned: oldPost=${rOldP} newPost=${rNewP} oldFresh=${rOldF} newFresh=${rNewF}
=====================================================================================
`)
      /* eslint-enable no-console */

      // Rows must actually come back — a fast query that returned nothing
      // would be the easiest way to fool this whole exercise.
      expect(rOldP).toBe(9)
      expect(rNewP).toBe(9)
      expect(rOldF).toBe(9)
      expect(rNewF).toBe(9)
    })
  })
})

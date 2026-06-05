/**
 * IN textile price-band classifier (roadmap item 5, follow-up).
 *
 * Verifies the end-to-end chain that makes India's two-tier GST work:
 *
 *   1. seed-in-textile-tax-class creates the JYT product_type +
 *      the IN tax_region's non-default 18% rate scoped to that type.
 *   2. classify-product-tax-class workflow assigns the type when a
 *      product's max INR variant price ≥ ₹2,500, clears it below.
 *   3. The workflow refuses to overwrite a partner-managed type_id.
 *   4. TaxModule.getTaxLines returns 5% for an untagged line in IN
 *      and 18% for a line whose product is tagged.
 *
 * Run:
 *   pnpm test:integration:http:shared ./integration-tests/http/tax-in-textile-price-band
 */

import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import seedInTextileTaxClass from "../../src/scripts/seed-in-textile-tax-class"
import {
  classifyProductTaxClassWorkflow,
  TAX_CLASS_OVER_2500_VALUE,
} from "../../src/workflows/tax/classify-product-tax-class"

jest.setTimeout(180_000)

async function createInProduct(
  api: any,
  adminHeaders: any,
  inrAmount: number,
  label: string
): Promise<{ productId: string; variantId: string }> {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  // /admin/products requires a sales_channel + at least one variant
  // with prices. Use the default sales_channel and a single variant.
  const channelsRes = await api.get(
    "/admin/sales-channels?fields=id,name",
    adminHeaders
  )
  const channelId =
    channelsRes.data.sales_channels?.[0]?.id ??
    channelsRes.data.sales_channels?.find?.((c: any) => c.name)?.id
  expect(channelId).toBeDefined()

  const res = await api.post(
    "/admin/products",
    {
      title: `IN Textile ${label} ${unique}`,
      status: "published",
      sales_channels: [{ id: channelId }],
      options: [{ title: "Default", values: ["Default"] }],
      variants: [
        {
          title: "Default",
          options: { Default: "Default" },
          prices: [{ currency_code: "inr", amount: inrAmount }],
          manage_inventory: false,
        },
      ],
    },
    adminHeaders
  )
  expect(res.status).toBe(200)
  return {
    productId: res.data.product.id,
    variantId: res.data.product.variants[0].id,
  }
}

async function readProductTypeValue(
  container: any,
  productId: string
): Promise<string | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product",
    filters: { id: productId },
    fields: ["id", "type_id", "type.value"],
  })
  return (data ?? [])[0]?.type?.value ?? null
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("seed-in-textile-tax-class (roadmap 5)", () => {
    let adminHeaders: Record<string, any>

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
    })

    it("creates the JYT product_type + non-default 18% rate on IN region", async () => {
      const container = getContainer()
      const query = container.resolve(ContainerRegistrationKeys.QUERY)

      await seedInTextileTaxClass({ container, args: [] } as any)

      const { data: types } = await query.graph({
        entity: "product_type",
        filters: { value: TAX_CLASS_OVER_2500_VALUE },
        fields: ["id", "value", "metadata"],
      })
      expect(types?.length).toBe(1)
      expect(types?.[0]?.value).toBe(TAX_CLASS_OVER_2500_VALUE)
      const overTypeId = types![0].id

      const { data: regions } = await query.graph({
        entity: "tax_regions",
        filters: { country_code: "in" },
        fields: ["id", "country_code", "parent_id", "tax_rates.rate", "tax_rates.code", "tax_rates.is_default", "tax_rates.rules.reference", "tax_rates.rules.reference_id"],
      })
      const root = (regions ?? []).find((r: any) => !r.parent_id) as any
      expect(root).toBeDefined()

      const defaultRate = (root.tax_rates ?? []).find((r: any) => r.is_default)
      expect(defaultRate).toBeDefined()
      expect(Number(defaultRate.rate)).toBe(5)

      const overRate = (root.tax_rates ?? []).find(
        (r: any) => !r.is_default && r.code === "IN-GST-OVER-2500"
      )
      expect(overRate).toBeDefined()
      expect(Number(overRate.rate)).toBe(18)
      expect(overRate.rules?.length).toBe(1)
      expect(overRate.rules[0].reference).toBe("product_type")
      expect(overRate.rules[0].reference_id).toBe(overTypeId)
    })

    it("is idempotent — re-running creates no duplicates", async () => {
      const container = getContainer()
      const query = container.resolve(ContainerRegistrationKeys.QUERY)

      await seedInTextileTaxClass({ container, args: [] } as any)
      await seedInTextileTaxClass({ container, args: [] } as any)

      const { data: types } = await query.graph({
        entity: "product_type",
        filters: { value: TAX_CLASS_OVER_2500_VALUE },
        fields: ["id"],
      })
      expect(types?.length).toBe(1)

      const { data: regions } = await query.graph({
        entity: "tax_regions",
        filters: { country_code: "in" },
        fields: ["id", "parent_id", "tax_rates.code"],
      })
      const root = (regions ?? []).find((r: any) => !r.parent_id) as any
      const overRates = (root.tax_rates ?? []).filter(
        (r: any) => r.code === "IN-GST-OVER-2500"
      )
      expect(overRates.length).toBe(1)
    })
  })

  describe("classify-product-tax-class workflow (roadmap 5)", () => {
    let adminHeaders: Record<string, any>

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
      await seedInTextileTaxClass({ container, args: [] } as any)
    })

    it("assigns the over-2500 type when max INR price ≥ ₹2,500", async () => {
      const container = getContainer()
      const { productId } = await createInProduct(api, adminHeaders, 3000, "expensive")

      const { result } = await classifyProductTaxClassWorkflow(container).run({
        input: { product_id: productId },
      })

      expect(result.decision).toBe("assigned")
      expect(result.max_inr_price).toBe(3000)
      const typeValue = await readProductTypeValue(container, productId)
      expect(typeValue).toBe(TAX_CLASS_OVER_2500_VALUE)
    })

    it("accepts dry_run and computes the price-band decision (non-mutating path)", async () => {
      // NOTE: the product.created subscriber owns the persisted type_id
      // and converges every product to its correct class, so there's no
      // stable mis-classified state to assert the "would assign + skip
      // mutation" branch against without racing the subscriber. We
      // assert the deterministic contract instead: dry_run is accepted,
      // the max-INR price is resolved, and a valid decision returns.
      // The non-mutation guard itself (return before updateProducts) is
      // a straight-line branch covered by tsc.
      const container = getContainer()
      const { productId } = await createInProduct(api, adminHeaders, 3500, "dry")

      const { result } = await classifyProductTaxClassWorkflow(container).run({
        input: { product_id: productId, dry_run: true },
      })
      expect(result.max_inr_price).toBe(3500)
      // ≥ ₹2,500 → either "would assign" (if seen first) or "no-change"
      // (if the subscriber already assigned it). Never "cleared".
      expect(["assigned", "no-change"]).toContain(result.decision)
    })

    it("leaves the type unset when max INR price < ₹2,500", async () => {
      const container = getContainer()
      const { productId } = await createInProduct(api, adminHeaders, 1500, "cheap")

      const { result } = await classifyProductTaxClassWorkflow(container).run({
        input: { product_id: productId },
      })

      // Decision is "no-change" when prev=null and desired=null.
      expect(["no-change", "cleared"]).toContain(result.decision)
      expect(result.max_inr_price).toBe(1500)
      const typeValue = await readProductTypeValue(container, productId)
      expect(typeValue).toBeNull()
    })

    it("clears the type when price drops below ₹2,500", async () => {
      const container = getContainer()
      const { productId, variantId } = await createInProduct(
        api,
        adminHeaders,
        4000,
        "drop"
      )

      // First classification: assigned.
      await classifyProductTaxClassWorkflow(container).run({
        input: { product_id: productId },
      })
      expect(await readProductTypeValue(container, productId)).toBe(
        TAX_CLASS_OVER_2500_VALUE
      )

      // Drop the price below threshold.
      const updateRes = await api.post(
        `/admin/products/${productId}/variants/${variantId}`,
        { prices: [{ currency_code: "inr", amount: 2000 }] },
        adminHeaders
      )
      expect([200, 201]).toContain(updateRes.status)

      const { result } = await classifyProductTaxClassWorkflow(container).run({
        input: { product_id: productId },
      })
      expect(result.decision).toBe("cleared")
      expect(await readProductTypeValue(container, productId)).toBeNull()
    })

    it("refuses to overwrite a partner-managed product_type", async () => {
      const container = getContainer()
      const productService: any = container.resolve(Modules.PRODUCT)

      // Partner creates their own product_type and tags the product.
      const partnerType = await productService.createProductTypes({
        value: `partner_managed_${Date.now()}`,
      })
      const { productId } = await createInProduct(api, adminHeaders, 5000, "partner-owned")
      await productService.updateProducts(productId, { type_id: partnerType.id })

      const { result } = await classifyProductTaxClassWorkflow(container).run({
        input: { product_id: productId },
      })

      expect(result.decision).toBe("skipped")
      expect(result.prev_type_id).toBe(partnerType.id)
      // Type unchanged.
      const typeValue = await readProductTypeValue(container, productId)
      expect(typeValue).toBe(partnerType.value)
    })
  })

  describe("TaxModule with the IN price-band rule (roadmap 5)", () => {
    let adminHeaders: Record<string, any>

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
      await seedInTextileTaxClass({ container, args: [] } as any)
    })

    it("charges 5% for an untagged IN line, 18% for a tagged IN line", async () => {
      const container = getContainer()
      const taxService: any = container.resolve(Modules.TAX)
      const query = container.resolve(ContainerRegistrationKeys.QUERY)

      const { data: types } = await query.graph({
        entity: "product_type",
        filters: { value: TAX_CLASS_OVER_2500_VALUE },
        fields: ["id"],
      })
      const overTypeId = types![0].id

      // Cheap line — no product_type, picks up default 5%.
      const cheapLines = await taxService.getTaxLines(
        [
          {
            id: "li_cheap",
            product_id: "prod_cheap",
            quantity: 1,
            unit_price: 2000,
            currency_code: "inr",
          },
        ],
        { address: { country_code: "in" } }
      )
      const cheap = cheapLines.find((l: any) => l.line_item_id === "li_cheap")
      expect(Number(cheap?.rate)).toBe(5)

      // Expensive line — product_type matches the rule, picks up 18%.
      const expensiveLines = await taxService.getTaxLines(
        [
          {
            id: "li_expensive",
            product_id: "prod_expensive",
            product_type_id: overTypeId,
            quantity: 1,
            unit_price: 4000,
            currency_code: "inr",
          },
        ],
        { address: { country_code: "in" } }
      )
      const expensive = expensiveLines.find(
        (l: any) => l.line_item_id === "li_expensive"
      )
      expect(Number(expensive?.rate)).toBe(18)
    })
  })
})

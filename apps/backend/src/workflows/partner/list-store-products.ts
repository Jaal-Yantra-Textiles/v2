import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import type { RemoteQueryFunction } from "@medusajs/types"

export type ListStoreProductsInput = {
  partnerId: string
  storeId: string
}

export type StoreProductLink = {
  sales_channel_id: string
  product_id: string
  product: any
}

const listStoreProductsStep = createStep(
  "list-store-products-step",
  async (input: ListStoreProductsInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>

    // Verify partner has the store, and get default sales channel id
    const { data: partners } = await query.graph({
      entity: "partners",
      fields: ["*", "stores.*"],
      filters: { id: input.partnerId },
    })

    const partner = partners?.[0]
    // Cast to any to access dynamic link field 'stores' from graph result
    const stores = ((partner as any)?.stores || []) as Array<{
      id: string
      default_sales_channel_id?: string
    }>

    const store = stores.find((s) => s.id === input.storeId)
    if (!store) {
      throw new MedusaError(
        MedusaError.Types.UNAUTHORIZED,
        `Store ${input.storeId} is not associated with this partner`
      )
    }

    if (!store.default_sales_channel_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Store ${input.storeId} has no default sales channel configured`
      )
    }

    // Fetch products via sales_channel graph with product link expanded
    const { data: scData } = await query.graph({
      entity: "sales_channel",
      fields: [
        "id",
        "products_link.product.*",
        "products_link.product.collection.*",
        "products_link.product.sales_channels.*",
        "products_link.product.variants.id",
        "products_link.product.variants.title",
        "products_link.product.images.*",
        "products_link.product_id",
      ],
      filters: { id: store.default_sales_channel_id },
    })

    const sc = scData?.[0] || {}
    const links = ((sc as any)?.products_link || []) as Array<{
      product_id?: string
      product?: any
    }>

    const result: StoreProductLink[] = links.map((l) => ({
      sales_channel_id: String(store.default_sales_channel_id),
      product_id: (l?.product_id as string) || String(l?.product?.id),
      product: l?.product,
    }))

    return new StepResponse(result)
  }
)

export type ListStoreProductsOutput = {
  products: any[]
  count: number
  offset: number
  limit: number
  /** Whose catalog this is — the admin mirror serves several partners. */
  partner_id: string
  /** Which of the partner's stores this listing came from. */
  store_id: string
}

export const listStoreProductsWorkflow = createWorkflow(
  {
    name: "list-store-products",
    store: true,
  },
  (input: ListStoreProductsInput) => {
    const links = listStoreProductsStep(input)

    // #843 — the response shaping lives HERE rather than in the route, so the
    // admin inspection mirror (`GET /admin/partners/:id/products`) can serve the
    // exact payload the partner portal serves. Re-mapping links→products a
    // second time admin-side is precisely the seam the mirror exists to close.
    const output = transform({ links, input }, ({ links, input }) => {
      const products = ((links as any[]) || [])
        .map((l: any) => l?.product)
        .filter(Boolean)

      return {
        products,
        count: products.length,
        // The partner products listing is unpaginated — the step returns the
        // store's whole channel-linked set. `offset`/`limit` are echoed for
        // response-shape parity with the other partner listings; they do NOT
        // slice, and changing that is a separate (partner-visible) decision.
        offset: 0,
        limit: 20,
        partner_id: input.partnerId,
        store_id: input.storeId,
      } as ListStoreProductsOutput
    })

    return new WorkflowResponse(output)
  }
)

export default listStoreProductsWorkflow

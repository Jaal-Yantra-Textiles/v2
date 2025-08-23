import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"

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
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

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
      fields: ["id", "products_link.product.*", "products_link.product_id"],
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

export const listStoreProductsWorkflow = createWorkflow(
  {
    name: "list-store-products",
    store: true,
  },
  (input: ListStoreProductsInput) => {
    const products = listStoreProductsStep(input)
    return new WorkflowResponse(products)
  }
)

export default listStoreProductsWorkflow

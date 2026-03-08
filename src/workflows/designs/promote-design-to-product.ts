import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createProductsWorkflow, sendNotificationsStep } from "@medusajs/medusa/core-flows"
import { DESIGN_MODULE } from "../../modules/designs"

type PromoteDesignToProductInput = {
  design_id: string
}

type PromoteDesignToProductOutput = {
  skipped: boolean
  skip_reason?: string
  product_id?: string
  is_new_product?: boolean
}

const promoteDesignStep = createStep(
  "promote-design-to-product-step",
  async ({ design_id }: PromoteDesignToProductInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any

    // Fetch design with linked products and linked folder
    const { data: designs } = await query.graph({
      entity: "design",
      filters: { id: design_id },
      fields: [
        "id",
        "name",
        "description",
        "thumbnail_url",
        "color_palette",
        "status",
        "design_type",
        "tags",
        // linked product (via product-design-link)
        "products.*",
        // linked folder (via design-media-folder-link)
        "folders.*",
        "folders.media_files.*",
      ],
    })

    if (!designs?.length) {
      throw new Error(`Design not found: ${design_id}`)
    }

    const design = designs[0]

    // Idempotency — skip if already has a linked product
    if (design.products?.length > 0) {
      return new StepResponse(
        { skipped: true, skip_reason: "Design already has a linked product" },
        null
      )
    }

    // Must have a linked media folder
    const folder = design.folders?.[0]
    if (!folder) {
      return new StepResponse(
        { skipped: true, skip_reason: "No media folder linked to this design" },
        null
      )
    }

    // Get image files from the folder
    const imageFiles: Array<{ file_path: string }> =
      (folder.media_files ?? []).filter(
        (f: any) => f.file_type === "image" || f.mime_type?.startsWith("image/")
      )

    if (!imageFiles.length) {
      return new StepResponse(
        { skipped: true, skip_reason: "Linked media folder has no image files" },
        null
      )
    }

    // Resolve default sales channel
    const storeService = container.resolve(Modules.STORE) as any
    const [store] = await storeService.listStores({})

    // Build product payload from design data
    const thumbnail = imageFiles[0].file_path
    const images = imageFiles.map((f) => ({ url: f.file_path }))

    // Flatten color palette into a readable string for the description suffix
    let colorNote = ""
    if (design.color_palette) {
      const palette = Array.isArray(design.color_palette)
        ? design.color_palette
        : Object.values(design.color_palette)
      if (palette.length) {
        colorNote = ` Available in: ${palette.join(", ")}.`
      }
    }

    const productPayload: any = {
      title: design.name,
      description: `${design.description || design.name}.${colorNote}`.trim(),
      status: "draft",
      is_giftcard: false,
      discountable: true,
      thumbnail,
      images,
      metadata: {
        promoted_from_design: true,
        design_id: design.id,
        design_type: design.design_type,
        source_folder_id: folder.id,
      },
      variants: [
        {
          title: "Default",
          manage_inventory: false,
          prices: [],
        },
      ],
    }

    if (store?.default_sales_channel_id) {
      productPayload.sales_channels = [{ id: store.default_sales_channel_id }]
    }

    // Create the draft product
    const { result } = await createProductsWorkflow(container).run({
      input: { products: [productPayload] },
    })

    const product = result?.[0]
    if (!product) {
      throw new Error("Failed to create product from design")
    }

    // Create product-design link
    await remoteLink.create({
      [Modules.PRODUCT]: { product_id: product.id },
      [DESIGN_MODULE]: { design_id: design.id },
    })

    return new StepResponse(
      { skipped: false, product_id: product.id, is_new_product: true },
      { product_id: product.id, design_id: design.id }
    )
  },
  // Compensation: remove the product and link on failure
  async (data, { container }) => {
    if (!data) return
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any
    const productService = container.resolve(Modules.PRODUCT) as any

    try {
      await remoteLink.dismiss({
        [Modules.PRODUCT]: { product_id: data.product_id },
        [DESIGN_MODULE]: { design_id: data.design_id },
      })
    } catch {}

    try {
      await productService.deleteProducts([data.product_id])
    } catch {}
  }
)

export const promoteDesignToProductWorkflow = createWorkflow(
  "promote-design-to-product",
  (input: PromoteDesignToProductInput) => {
    const result = promoteDesignStep(input)

    // Feed notification — always fires (skipped or created)
    sendNotificationsStep([
      {
        to: "",
        channel: "feed" as const,
        template: "admin-ui" as const,
        data: {
          title: "Design promoted to draft product",
          description: `Design ${input.design_id} has been promoted to a draft product ready for review.`,
        },
      },
    ])

    return new WorkflowResponse(result)
  }
)

export default promoteDesignToProductWorkflow

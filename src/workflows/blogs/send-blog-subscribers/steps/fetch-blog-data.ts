import { MedusaError } from "@medusajs/framework/utils"
import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { SendBlogSubscribersInput } from "../types"
import { WEBSITE_MODULE } from "../../../../modules/website"

export const fetchBlogDataStepId = "fetch-blog-data"

/**
 * This step fetches the blog data that will be sent to subscribers.
 * It validates that the blog exists, is of type Blog, and is published.
 *
 * @example
 * const blogData = fetchBlogDataStep({ page_id: "blog_123", subject: "New Blog Post" })
 */
export const fetchBlogDataStep = createStep(
  fetchBlogDataStepId,
  async (input: SendBlogSubscribersInput, { container }) => {
      const pageService = container.resolve(WEBSITE_MODULE)
      
      // Retrieve the page with necessary relations
      const page = await pageService.retrievePage(input.page_id, {
        relations: ["blocks"]
      })
      
      if (!page) {
        throw new MedusaError(
          MedusaError.Types.NOT_FOUND,
          `Blog with id ${input.page_id} not found`
        )
      }
      
      if (page.page_type !== "Blog") {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Only blog pages can be sent to subscribers"
        )
      }
      
      if (page.status !== "Published") {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Only published blogs can be sent to subscribers"
        )
      }
      
      console.log(`Successfully fetched blog: ${page.title}`)
      
      return new StepResponse({
        id: page.id,
        title: page.title,
        slug: page.slug,
        content: page.content,
        status: page.status,
        blocks: page.blocks,
        created_at: page.created_at,
        updated_at: page.updated_at,
        url: `/blog/${page.slug}`
      })
  }
)

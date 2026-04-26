import { MedusaError } from "@medusajs/framework/utils"
import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { SendBlogSubscribersInput } from "../types"
import { WEBSITE_MODULE } from "../../../../modules/website"
import WebsiteService from "../../../../modules/website/service"

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
      const pageService: WebsiteService = container.resolve(WEBSITE_MODULE)
      
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
      
      // Extract the TipTap JSON content from the blog blocks
      let blogContent: any = null
      
      // Find the blog content block which contains the TipTap JSON
      if (page.blocks && page.blocks.length > 0) {
        // Look for a block with content.text that contains TipTap JSON
        const contentBlock = page.blocks.find(block => 
          block.content && 
          block.content.text && 
          (typeof block.content.text === 'object' || 
           (typeof block.content.text === 'string' && 
            (block.content.text.includes('"type":"doc"') || block.content.text.startsWith('{'))))
        )
        
        if (contentBlock) {
          blogContent = contentBlock.content.text
          console.log('Found TipTap content block')
        }
      }
      
      // If no specific block with TipTap content is found, use the page content as fallback
      if (!blogContent) {
        blogContent = page.content
        console.log('Using page content as fallback')
      }
      
      return new StepResponse({
        id: page.id,
        title: page.title,
        slug: page.slug,
        content: blogContent, // Use the extracted TipTap content
        status: page.status,
        blocks: page.blocks,
        created_at: page.created_at,
        updated_at: page.updated_at,
        subscriber_count: page.subscriber_count,
        url: `/blog/${page.slug}`
      })
  }
)

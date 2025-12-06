import { 
  ContentRule, 
  GeneratedContent, 
  DEFAULT_CONTENT_RULES 
} from "../types/publishing-automation"

/**
 * Content Generator Service
 * 
 * Transforms product data into social media post content using content rules.
 * Handles template rendering, description truncation, hashtag generation, and media selection.
 * 
 * This is a utility service that doesn't require database access,
 * so it's a plain class (not a MedusaService).
 */
export class ContentGeneratorService {
  
  /**
   * Generate social media content from a product using a content rule
   */
  async generateContent(
    product: ProductData,
    design: DesignData | null,
    rule: ContentRule
  ): Promise<GeneratedContent> {
    // Build template context
    const context = this.buildTemplateContext(product, design, rule)
    
    // Render caption from template
    const caption = this.renderTemplate(rule.caption_template, context)
    
    // Select media attachments
    const media_attachments = this.selectMedia(product, rule)
    
    // Extract/generate hashtags
    const hashtags = this.generateHashtags(product, design, rule)
    
    return {
      caption,
      media_attachments,
      hashtags,
      product_title: product.title,
      product_id: product.id,
      design: design ? {
        id: design.id,
        name: design.name,
        description: design.description,
      } : undefined,
    }
  }
  
  /**
   * Get default content rule for a platform
   */
  getDefaultRule(platformName: string): ContentRule {
    const normalizedName = platformName.toLowerCase().replace(/\s+/g, "")
    
    // Handle variations
    if (normalizedName === "twitter" || normalizedName === "x") {
      return DEFAULT_CONTENT_RULES.x
    }
    if (normalizedName === "facebook&instagram" || normalizedName === "fbinsta") {
      return DEFAULT_CONTENT_RULES.fbinsta
    }
    
    return DEFAULT_CONTENT_RULES[normalizedName] || DEFAULT_CONTENT_RULES.instagram
  }
  
  /**
   * Build template context from product and design data
   */
  private buildTemplateContext(
    product: ProductData,
    design: DesignData | null,
    rule: ContentRule
  ): TemplateContext {
    // Truncate description
    const description = this.truncateText(
      product.description || "",
      rule.description_max_length
    )
    
    // Format price
    const price = product.variants?.[0]?.prices?.[0]
      ? this.formatPrice(product.variants[0].prices[0])
      : null
    
    // Build hashtags string
    const hashtagList = this.generateHashtags(product, design, rule)
    const hashtags = hashtagList.map(h => h.startsWith("#") ? h : `#${h}`).join(" ")
    
    return {
      title: product.title,
      description,
      price: rule.include_price ? price : null,
      url: product.metadata?.url as string || null,
      design_name: rule.include_design && design ? design.name : null,
      design_description: rule.include_design && design 
        ? this.truncateText(design.description || "", 100) 
        : null,
      hashtags,
    }
  }
  
  /**
   * Simple template renderer with Handlebars-like syntax
   * Supports: {{variable}}, {{#if variable}}...{{/if}}
   */
  private renderTemplate(template: string, context: TemplateContext): string {
    let result = template
    
    // Handle conditionals: {{#if variable}}content{{/if}}
    const conditionalRegex = /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g
    result = result.replace(conditionalRegex, (_, variable, content) => {
      const value = context[variable as keyof TemplateContext]
      return value ? content : ""
    })
    
    // Handle simple variables: {{variable}}
    const variableRegex = /\{\{(\w+)\}\}/g
    result = result.replace(variableRegex, (_, variable) => {
      const value = context[variable as keyof TemplateContext]
      return value !== null && value !== undefined ? String(value) : ""
    })
    
    // Clean up extra newlines
    result = result.replace(/\n{3,}/g, "\n\n").trim()
    
    return result
  }
  
  /**
   * Select media attachments based on rule
   */
  private selectMedia(
    product: ProductData,
    rule: ContentRule
  ): Array<{ type: "image" | "video"; url: string }> {
    const images = product.images || []
    const media: Array<{ type: "image" | "video"; url: string }> = []
    
    if (images.length === 0) {
      // Try thumbnail
      if (product.thumbnail) {
        media.push({ type: "image", url: product.thumbnail })
      }
      return media
    }
    
    switch (rule.image_selection) {
      case "thumbnail":
        if (product.thumbnail) {
          media.push({ type: "image", url: product.thumbnail })
        } else if (images[0]) {
          media.push({ type: "image", url: images[0].url })
        }
        break
        
      case "first":
        if (images[0]) {
          media.push({ type: "image", url: images[0].url })
        }
        break
        
      case "featured":
        // Use thumbnail or first image
        const featuredUrl = product.thumbnail || images[0]?.url
        if (featuredUrl) {
          media.push({ type: "image", url: featuredUrl })
        }
        break
        
      case "all":
      default:
        images.slice(0, rule.max_images).forEach(img => {
          media.push({ type: "image", url: img.url })
        })
        break
    }
    
    return media
  }
  
  /**
   * Generate hashtags based on strategy
   */
  private generateHashtags(
    product: ProductData,
    design: DesignData | null,
    rule: ContentRule
  ): string[] {
    const hashtags: string[] = []
    
    switch (rule.hashtag_strategy) {
      case "custom":
        return rule.custom_hashtags
        
      case "from_product":
        // Extract from product tags
        if (product.tags && Array.isArray(product.tags)) {
          product.tags.forEach(tag => {
            const tagValue = typeof tag === "string" ? tag : tag.value
            if (tagValue) {
              hashtags.push(this.toHashtag(tagValue))
            }
          })
        }
        // Add product type/category
        if (product.type?.value) {
          hashtags.push(this.toHashtag(product.type.value))
        }
        break
        
      case "from_design":
        // Extract from design tags
        if (design?.tags && Array.isArray(design.tags)) {
          design.tags.forEach(tag => {
            hashtags.push(this.toHashtag(String(tag)))
          })
        }
        // Add design name as hashtag
        if (design?.name) {
          hashtags.push(this.toHashtag(design.name))
        }
        break
        
      case "none":
      default:
        return []
    }
    
    // Deduplicate and limit
    return [...new Set(hashtags)].slice(0, 10)
  }
  
  /**
   * Convert text to valid hashtag
   */
  private toHashtag(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 30)
  }
  
  /**
   * Truncate text with ellipsis
   */
  private truncateText(text: string, maxLength: number): string {
    if (!text || text.length <= maxLength) {
      return text
    }
    
    // Try to break at word boundary
    const truncated = text.slice(0, maxLength - 3)
    const lastSpace = truncated.lastIndexOf(" ")
    
    if (lastSpace > maxLength * 0.7) {
      return truncated.slice(0, lastSpace) + "..."
    }
    
    return truncated + "..."
  }
  
  /**
   * Format price for display
   */
  private formatPrice(price: { amount: number; currency_code: string }): string {
    const amount = price.amount / 100 // Assuming cents
    const formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: price.currency_code.toUpperCase(),
    })
    return formatter.format(amount)
  }
  
  /**
   * Validate content against platform limits
   */
  validateContent(
    content: GeneratedContent,
    platformName: string
  ): { valid: boolean; warnings: string[] } {
    const warnings: string[] = []
    const normalizedPlatform = platformName.toLowerCase()
    
    // Character limits
    if (normalizedPlatform === "x" || normalizedPlatform === "twitter") {
      if (content.caption.length > 280) {
        warnings.push(`Caption exceeds Twitter's 280 character limit (${content.caption.length} chars)`)
      }
      if (content.media_attachments.length > 4) {
        warnings.push(`Twitter supports max 4 images (${content.media_attachments.length} provided)`)
      }
    }
    
    // Instagram requires media
    if (normalizedPlatform === "instagram" || normalizedPlatform === "fbinsta") {
      if (content.media_attachments.length === 0) {
        warnings.push("Instagram requires at least one image or video")
      }
    }
    
    // General warnings
    if (content.media_attachments.length === 0) {
      warnings.push("No media attachments - post will be text-only")
    }
    
    return {
      valid: warnings.length === 0,
      warnings,
    }
  }
}

/**
 * Product data structure (from Medusa Product module)
 */
interface ProductData {
  id: string
  title: string
  description?: string
  thumbnail?: string
  images?: Array<{ url: string }>
  tags?: Array<{ value: string } | string>
  type?: { value: string }
  variants?: Array<{
    prices?: Array<{
      amount: number
      currency_code: string
    }>
  }>
  metadata?: Record<string, unknown>
}

/**
 * Design data structure
 */
interface DesignData {
  id: string
  name: string
  description?: string
  tags?: unknown[]
  thumbnail_url?: string
}

/**
 * Template context for rendering
 */
interface TemplateContext {
  title: string
  description: string
  price: string | null
  url: string | null
  design_name: string | null
  design_description: string | null
  hashtags: string
}

export default ContentGeneratorService

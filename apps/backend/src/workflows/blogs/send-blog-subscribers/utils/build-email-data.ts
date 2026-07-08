import { convertTipTapToHtml } from "./tiptap-to-html"

/**
 * Converts blog content to HTML, handling TipTap JSON and plain text formats.
 * Shared by the production batch send and the test-send path so both render
 * the redesigned `blog-subscriber` template from identical data.
 */
export function convertContentToHtml(content: any): string {
  if (typeof content === "object") {
    return convertTipTapToHtml(content)
  }

  if (typeof content === "string") {
    if (content.includes('"type":"doc"') || content.startsWith("{")) {
      try {
        return convertTipTapToHtml(JSON.parse(content))
      } catch {
        return convertTipTapToHtml(content)
      }
    }
    return content
  }

  return String(content || "")
}

export interface BlogEmailSubscriber {
  id: string
  email: string
  first_name?: string
  last_name?: string
}

export interface BlogEmailConfig {
  subject: string
  customMessage?: string
}

/**
 * Builds the email data payload for a subscriber.
 *
 * This is the single source of truth for the variables passed to the
 * `blog-subscriber` Handlebars template. Both the production batch send
 * (`process-all-batches`) and the test-send (`send-test-email`) use it so a
 * test email renders exactly what subscribers will receive.
 *
 * - UTM-tags every outbound link (utm_source=newsletter, utm_medium=email,
 *   utm_campaign=<post slug>) so newsletter/blog traffic is attributable.
 * - Carries the email alongside the person id on the unsubscribe URL so the
 *   unsubscribe endpoint can suppress by email even when the id can't resolve.
 * - Passes the two-doors CTAs: shop_url (cicilabel.com) + create_url (jaalyantra.com).
 */
export function buildEmailData(
  subscriber: BlogEmailSubscriber,
  blogData: any,
  htmlContent: string,
  emailConfig: BlogEmailConfig,
  options?: { isTest?: boolean }
): Record<string, any> {
  const frontend = process.env.FRONTEND_URL || "https://jaalyantra.com"
  const campaign = (blogData?.slug || "blog_broadcast").toString()
  const UTM = `utm_source=newsletter&utm_medium=email&utm_campaign=${encodeURIComponent(campaign)}`
  const withUtm = (u: string) => (u ? `${u}${u.includes("?") ? "&" : "?"}${UTM}` : u)

  return {
    blog_title: blogData.title,
    blog_content: htmlContent,
    blog_url: withUtm(`${frontend}${blogData.url}`),
    blog_created_at: blogData.created_at,
    blog_updated_at: blogData.updated_at,
    blog_tags: blogData.tags || [],
    first_name: subscriber.first_name || "",
    last_name: subscriber.last_name || "",
    email: subscriber.email,
    subscriber_id: subscriber.id,
    subject: emailConfig.subject,
    custom_message: emailConfig.customMessage || "",
    unsubscribe_url: `${frontend}/unsubscribe?id=${encodeURIComponent(
      subscriber.id
    )}&email=${encodeURIComponent(subscriber.email)}`,
    website_url: withUtm(frontend),
    shop_url: withUtm("https://cicilabel.com"),
    create_url: withUtm("https://jaalyantra.com"),
    current_year: new Date().getFullYear().toString(),
    is_test: options?.isTest ?? false,
    blog: {
      title: blogData.title,
      content: htmlContent,
      url: `${frontend}${blogData.url}`,
      created_at: blogData.created_at,
      updated_at: blogData.updated_at,
      tags: blogData.tags || [],
    },
    person: {
      first_name: subscriber.first_name || "",
      last_name: subscriber.last_name || "",
      email: subscriber.email,
      id: subscriber.id,
    },
  }
}

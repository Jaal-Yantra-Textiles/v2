import { model } from "@medusajs/framework/utils";
import Page from "./page";
import WebsiteDomain from "./website-domain";
const Website = model.define("website", {
  id: model.id().primaryKey(),
  domain: model.text().unique(),
  name: model.text().searchable(),
  description: model.text().nullable(),
  status: model.enum([
    "Active",
    "Inactive",
    "Maintenance",
    "Development"
  ]).default("Development"),
  primary_language: model.text().default("en"),
  supported_languages: model.json().nullable(),
  favicon_url: model.text().nullable(),
  theme: model.json().nullable(),
  metadata: model.json().nullable(),

  // Analytics provider for the storefront. "in_house" injects the
  // CDN-hosted JYT analytics script (apps/analytics → automatic.jaalyantra.com).
  // "custom" injects whatever the partner pasted into analytics_custom_head /
  // analytics_custom_body_end. "off" injects nothing.
  analytics_provider: model.enum([
    "in_house",
    "custom",
    "off",
  ]).default("in_house"),
  // Raw HTML/script block injected into <head> when analytics_provider === "custom".
  analytics_custom_head: model.text().nullable(),
  // Raw HTML/script block injected before </body> when analytics_provider === "custom".
  // Useful for GTM noscript fallbacks and providers that want a body-end tag.
  analytics_custom_body_end: model.text().nullable(),

  // Google Search Console site-verification token (#349). Each storefront domain
  // is a separate GSC property, so this is per-Website. The storefront-starter
  // reads it from the public /web/website/[domain] API and always injects
  // <meta name="google-site-verification" content="…"> into <head> — independent
  // of analytics_provider (analytics_custom_head only renders for the "custom"
  // provider, so it can't double as the SEO hook).
  google_site_verification: model.text().nullable(),

  // Relationship with Pages
  pages: model.hasMany(() => Page),
  // Extra domains that resolve to this website (aliases, custom domains, etc.)
  domains: model.hasMany(() => WebsiteDomain),
})
.cascades(
  {
    delete: ['pages', 'domains']
  }
)

export default Website;

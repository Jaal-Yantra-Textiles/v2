/**
 * Resolve the storefront's public base URL.
 *
 * Priority:
 * 1. NEXT_PUBLIC_BASE_URL — explicit override. This is the canonical-domain
 *    lever: set it to the apex (e.g. https://cicilabel.com) to make every
 *    canonical tag, sitemap entry, robots `Sitemap:` line and JSON-LD `url`
 *    resolve to the apex instead of whatever alias host Vercel injects
 *    (audit #734 #1 — canonical pointed at shop.cicilabel.com). next.config.js
 *    derives the www./shop. → apex 301s from this same value.
 * 2. VERCEL_PROJECT_PRODUCTION_URL — injected by Vercel into every
 *    deployment; resolves to the project's production domain (the
 *    partner's custom domain when one is attached). This is what makes
 *    canonicals / sitemap / robots correct on partner storefronts with
 *    zero per-project configuration.
 * 3. VERCEL_URL — the deployment's own *.vercel.app host (previews)
 * 4. localhost — local dev only
 *
 * Without 2–4 every partner store shipped `https://localhost:8000`
 * canonicals and sitemap entries to Google (roadmap #12).
 */
export const getBaseURL = () => {
  if (process.env.NEXT_PUBLIC_BASE_URL) {
    return process.env.NEXT_PUBLIC_BASE_URL
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }
  return "https://localhost:8000"
}

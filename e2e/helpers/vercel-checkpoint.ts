import type { Page, Response } from "@playwright/test"

/**
 * Stop a LIVE storefront spec the moment Vercel's firewall answers instead of
 * the storefront.
 *
 * Since 2026-11-22 the `storefront-shared` Vercel project has the Bot
 * Protection managed rule on (action: challenge). Non-browser clients (curl)
 * and GitHub Actions runners get HTTP 429 and a page titled "Vercel Security
 * Checkpoint" instead of the partner's store, retries included. A browser on an
 * ordinary connection, headless Chromium on a laptop included, passes the
 * challenge and sees the normal page.
 *
 * Without this check the specs failed as "title is Vercel Security Checkpoint"
 * or as a 120 s wait for a `<meta>` / testid that the checkpoint page will
 * never have, which read like a storefront regression. It was not one.
 */
export async function assertNotVercelCheckpoint(
  page: Page,
  response: Response | null
): Promise<void> {
  const mitigated = response?.headers()["x-vercel-mitigated"]
  const title = await page.title().catch(() => "")

  if (mitigated || /Vercel Security Checkpoint/i.test(title)) {
    throw new Error(
      `${page.url()} answered with Vercel's firewall, not the storefront ` +
        `(status ${response?.status() ?? "?"}, x-vercel-mitigated=` +
        `${mitigated ?? "none"}, title "${title}"). The live site's Bot ` +
        `Protection did not let this browser through (it blocks GitHub ` +
        `runners), so this spec cannot see the page from here. ` +
        `This is NOT evidence about the storefront itself.`
    )
  }
}

import http from "node:http"
import type { AddressInfo } from "node:net"
import { Modules } from "@medusajs/framework/utils"

import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { DESIGN_MODULE } from "../../src/modules/designs"
import { verifyDesignAccessToken } from "../../src/lib/design-access/token"
import {
  runAddReferenceLink,
  runListMyDesigns,
  runStartNewDesign,
  runSwitchDesign,
} from "../../src/mastra/agents/tools/storefront-design-multi"
import type { DesignContext } from "../../src/mastra/agents/tools/storefront-design-flow"

jest.setTimeout(240 * 1000)

/**
 * Several designs in one chat, and references from pasted links.
 *
 * A real page is served from 127.0.0.1 (the safe fetcher opens loopback to
 * tests only) with an Open Graph image, so the link tool goes through the
 * real fetch → copy into storage → pin path. Vision is best-effort and has no
 * provider here; the reference still pins.
 *
 * One test, because the runner restores the DB before every `it`.
 */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
)

setupSharedTestSuite(() => {
  describe("design chat — several designs + reference links", () => {
    const container = () => getSharedTestEnv().getContainer()
    let server: http.Server
    let base: string
    const previousFlag = process.env.WEBSITE_SCAN_ALLOW_PRIVATE_HOSTS

    beforeAll(async () => {
      process.env.WEBSITE_SCAN_ALLOW_PRIVATE_HOSTS = "true"
      server = http.createServer((req, res) => {
        if (req.url === "/pin") {
          res.writeHead(200, { "content-type": "text/html" })
          res.end(`<html><head><meta property="og:title" content="Indigo kurta">
            <meta property="og:image" content="/kurta.png"></head></html>`)
        } else if (req.url === "/kurta.png") {
          res.writeHead(200, { "content-type": "image/png" })
          res.end(PNG_1X1)
        } else if (req.url === "/login") {
          res.writeHead(200, { "content-type": "text/html" })
          res.end("<html><title>Log in</title></html>")
        } else {
          res.writeHead(404)
          res.end()
        }
      })
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    })

    afterAll(async () => {
      process.env.WEBSITE_SCAN_ALLOW_PRIVATE_HOSTS = previousFlag
      await new Promise((r) => server.close(r))
    })

    it("pins a link, starts a second piece, switches back, and lists both", async () => {
      const customers: any = container().resolve(Modules.CUSTOMER)
      const { id: customer_id } = await customers.createCustomers({
        email: `multi-${Date.now()}@jyt.test`,
        has_account: true,
      })
      const designs: any = container().resolve(DESIGN_MODULE)
      const ctx: DesignContext = { customer_id, client_ip: "203.0.113.7" }

      // ── 1. a link with no design yet → a design is made, the picture pinned ──
      const linked: any = await runAddReferenceLink(container(), { url: `${base}/pin` }, ctx)
      expect(linked).toMatchObject({ ok: true, added: 1, created_design: true, page_title: "Indigo kurta" })
      const first = linked.design_id as string
      expect(ctx.design_id).toBe(first)
      expect(verifyDesignAccessToken(linked.design_token, first)).toBeTruthy()

      const d1 = await designs.retrieveDesign(first)
      const pinned = (d1.moodboard?.elements ?? []).filter(
        (el: any) => el.customData?.source === "inspiration"
      )
      expect(pinned).toHaveLength(1)
      // 🔑 Copied into OUR storage — never a hot-link to the page's host.
      expect(pinned[0].link).not.toContain("127.0.0.1")
      expect(d1.media_files).toHaveLength(1)
      expect(d1.inspiration_sources).toEqual([`${base}/pin`])

      // A login wall is explained, not pinned as a "photo".
      const wall: any = await runAddReferenceLink(container(), { url: `${base}/login` }, ctx)
      expect(wall.ok).toBe(false)
      expect(wall.message).toMatch(/No picture/)

      // ── 2. another piece → a NEW design (not folded into the open one) ──
      const started: any = await runStartNewDesign(
        container(),
        { name: "Matching trousers", product_type: "trousers" },
        ctx
      )
      expect(started.design_id).not.toBe(first)
      expect(started.previous_design_id).toBe(first)
      expect(ctx.design_id).toBe(started.design_id)
      expect(ctx.designs?.map((d) => d.design_id)).toEqual([first])
      // The garment is saved on the design, so the next turn knows it.
      expect((await designs.retrieveDesign(started.design_id)).product_type).toBe("trousers")

      // ── 3. back to the first ──
      const switched = await runSwitchDesign(container(), first, ctx)
      expect(switched).toMatchObject({ design_id: first, references: 1, active: true })
      expect(ctx.design_id).toBe(first)
      expect(ctx.designs?.map((d) => d.design_id)).toEqual([started.design_id])

      // ── 4. the list holds both, active marked, each with its own token ──
      const listed = await runListMyDesigns(container(), ctx)
      const byId = new Map(listed.designs.map((d) => [d.design_id, d]))
      expect(byId.get(first)?.active).toBe(true)
      expect(byId.get(started.design_id)?.product_type).toBe("trousers")
      expect(verifyDesignAccessToken(byId.get(started.design_id)?.design_token, started.design_id)).toBeTruthy()

      // ── 5. 🔴 a stranger cannot switch onto either design ──
      const stranger: DesignContext = { customer_id: "cus_someone_else" }
      await expect(runSwitchDesign(container(), first, stranger)).rejects.toThrow()
    })
  })
})

/**
 * Admin API — scan OUR records of a partner into capability proposals (#2249).
 *
 * Pinned:
 *   - only COMPLETED runs are evidence — a cancelled run proves nothing
 *   - a run's tasks become actions (stitching → stitch, embroidery → embroider)
 *   - a WhatsApp photo the partner sent FOR THAT RUN is evidence, and commit
 *     LINKS the media row we already hold instead of uploading a copy
 *   - cloth supplied on a Delivered inventory order is evidence of the
 *     material, but `weave` is NOT credited unless the partner said they weave
 *   - commit stamps source='records'
 *
 * Model off (WEBSITE_SCAN_MODEL=off): the mechanical grouping is what lands.
 */
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { PARTNER_MODULE } from "../../src/modules/partner"
import { DESIGN_MODULE } from "../../src/modules/designs"
import { PRODUCTION_RUNS_MODULE } from "../../src/modules/production_runs"
import { ORDER_INVENTORY_MODULE } from "../../src/modules/inventory_orders"
import { TASKS_MODULE } from "../../src/modules/tasks"
import { MEDIA_MODULE } from "../../src/modules/media"

jest.setTimeout(120 * 1000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Admin Partners API — records scan", () => {
    let adminHeaders: { headers: Record<string, string> }
    let partnerId: string
    let mediaId: string
    const OLD_MODEL = process.env.WEBSITE_SCAN_MODEL
    const PHOTO_URL = "https://automatic.jaalyantra.com/automatica/wa-test-jacket.jpg"

    beforeAll(() => {
      process.env.WEBSITE_SCAN_MODEL = "off"
    })
    afterAll(() => {
      process.env.WEBSITE_SCAN_MODEL = OLD_MODEL
    })

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
      const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
      const link: any = container.resolve(ContainerRegistrationKeys.LINK)

      partnerId = (
        await (container.resolve(PARTNER_MODULE) as any).createPartners({
          name: `Records ${unique}`,
          handle: `records-${unique}`,
        })
      ).id

      // The WhatsApp saver writes a media_file whose file_path IS the URL.
      mediaId = (
        await (container.resolve(MEDIA_MODULE) as any).createMediaFiles({
          file_name: "wa-test-jacket.jpg",
          original_name: "wa-test-jacket.jpg",
          file_path: PHOTO_URL,
          file_size: 1234,
          file_type: "image",
          mime_type: "image/jpeg",
          extension: "jpg",
        })
      ).id

      const designs: any = container.resolve(DESIGN_MODULE)
      const runs: any = container.resolve(PRODUCTION_RUNS_MODULE)
      const design = await designs.createDesigns({
        name: `Wool Tweed Jacket ${unique}`,
        description: "records scan test",
        status: "In_Development",
        product_type: "jacket",
      })
      const done = await runs.createProductionRuns({
        design_id: design.id,
        partner_id: partnerId,
        status: "completed",
        run_type: "production",
        quantity: 3,
        produced_quantity: 3,
        completed_at: new Date("2026-09-10T00:00:00Z"),
        snapshot: {},
        captured_at: new Date(),
      })
      await runs.createProductionRuns({
        design_id: design.id,
        partner_id: partnerId,
        status: "cancelled",
        run_type: "production",
        quantity: 9,
        snapshot: {},
        captured_at: new Date(),
      })
      // The photo the partner sent for the COMPLETED run, and a reference image
      // that belongs to no run (must not count as evidence).
      await designs.updateDesigns({
        id: design.id,
        media_files: [
          { url: PHOTO_URL, source: "whatsapp", run_id: done.id, isThumbnail: false },
          { url: "https://automatic.jaalyantra.com/automatica/moodboard-ref.png", isThumbnail: true },
        ],
      })

      const tasks: any = container.resolve(TASKS_MODULE)
      const [stitching, embroidery] = await tasks.createTasks([
        { title: "Stitching", status: "completed", start_date: new Date("2026-09-01") },
        { title: "Embroidery and Painting", status: "completed", start_date: new Date("2026-09-01") },
      ])
      await link.create([
        { [PRODUCTION_RUNS_MODULE]: { production_runs_id: done.id }, [TASKS_MODULE]: { task_id: stitching.id } },
        { [PRODUCTION_RUNS_MODULE]: { production_runs_id: done.id }, [TASKS_MODULE]: { task_id: embroidery.id } },
      ])

      const orders: any = container.resolve(ORDER_INVENTORY_MODULE)
      const order = await orders.createInventoryOrders({
        quantity: 20,
        total_price: 4000,
        status: "Delivered",
        order_date: new Date("2026-08-01T00:00:00Z"),
      })
      await orders.createOrderLines({
        inventory_orders_id: order.id,
        quantity: 20,
        price: 200,
        material_name: "Kala Cotton",
        color: "Rust",
      })
      await link.create({
        [PARTNER_MODULE]: { partner_id: partnerId },
        [ORDER_INVENTORY_MODULE]: { inventory_orders_id: order.id },
      })

      // A run with no design: counted, never proposed.
      await runs.createProductionRuns({
        partner_id: partnerId,
        status: "completed",
        run_type: "production",
        quantity: 1,
        completed_at: new Date("2026-09-11T00:00:00Z"),
        snapshot: {},
        captured_at: new Date(),
      })

      // Their store's channel holds a legacy product (no ownership link — KEEP)
      // and one the ownership link gives to ANOTHER partner (shared channel — DROP).
      const other = await (container.resolve(PARTNER_MODULE) as any).createPartners({
        name: `Records Other ${unique}`,
        handle: `records-other-${unique}`,
      })
      const channel = await (container.resolve(Modules.SALES_CHANNEL) as any).createSalesChannels({ name: `Records SC ${unique}` })
      const store = await (container.resolve(Modules.STORE) as any).createStores({ name: `Records Store ${unique}`, default_sales_channel_id: channel.id })
      const productService: any = container.resolve(Modules.PRODUCT)
      const [legacy, foreign] = await productService.createProducts([
        { title: `Kantha Throw ${unique}`, status: "published" },
        { title: `Oshen Robe ${unique}`, status: "published" },
      ])
      await link.create([
        { [PARTNER_MODULE]: { partner_id: partnerId }, [Modules.STORE]: { store_id: store.id } },
        { [Modules.PRODUCT]: { product_id: legacy.id }, [Modules.SALES_CHANNEL]: { sales_channel_id: channel.id } },
        { [Modules.PRODUCT]: { product_id: foreign.id }, [Modules.SALES_CHANNEL]: { sales_channel_id: channel.id } },
        { [PARTNER_MODULE]: { partner_id: other.id }, [Modules.PRODUCT]: { product_id: foreign.id } },
      ])
    })

    const scan = () =>
      api.post(`/admin/partners/${partnerId}/capabilities/scan-records`, {}, adminHeaders)

    it("proposes from completed runs and supplied cloth only, with actions from the tasks", async () => {
      const res = await scan()
      expect(res.status).toBe(201)
      const { proposal, kind, platform } = res.data.scan
      expect([kind, platform]).toEqual(["records", "records"])

      const byType = Object.fromEntries(proposal.samples.map((s: any) => [s.product_type, s]))
      // throw = the legacy store product; the other partner's robe is NOT here,
      // and the designless run is not a "Production run prod_run_…" proposal
      expect(Object.keys(byType).sort()).toEqual(["fabric", "jacket", "throw"])
      const allEvidence = proposal.samples.flatMap((s: any) => s.evidence).join(" | ")
      expect(allEvidence).not.toMatch(/Oshen Robe/)
      expect(allEvidence).not.toMatch(/Production run prod_run/)
      expect(proposal.warnings.join()).toMatch(/1 completed run\(s\) have no design/)
      expect(proposal.warnings.join()).toMatch(/1 product\(s\) in their store's sales channel belong to another partner/)

      const jacket = byType.jacket
      expect(jacket.evidence).toHaveLength(1) // the cancelled run is NOT evidence
      expect(jacket.actions).toEqual(["embroider", "stitch"]) // vocabulary order
      expect(jacket.captured_at).toBe("2026-09-10T00:00:00.000Z")
      // the run's own photo, as the row we already hold — not the moodboard ref
      expect(jacket.media_file_ids).toEqual([mediaId])
      expect(jacket.image_urls).toEqual([])

      const fabric = byType.fabric
      expect(fabric.material).toBe("Kala Cotton")
      // supplying cloth is not weaving it, unless they told us so
      expect(fabric.actions).toEqual([])
    })

    it("commits as source='records', linking the existing photo rather than copying it", async () => {
      const { id: scanId, proposal } = (await scan()).data.scan
      const key = proposal.samples.find((s: any) => s.product_type === "jacket").key
      const res = await api.post(
        `/admin/partners/${partnerId}/capabilities/scans/${scanId}/commit`,
        { sample_keys: [key] },
        adminHeaders
      )
      expect(res.status).toBe(200)
      expect(res.data.warnings).toEqual([])

      const [sample] = (await api.get(`/admin/partners/${partnerId}/capabilities`, adminHeaders)).data.samples
      expect(sample.source).toBe("records")
      expect(sample.actions).toEqual(["embroider", "stitch"])
      expect(sample.media_file_ids).toEqual([mediaId])
      expect(sample.source_url).toBeNull()
    })

    it("lists the partner's scans, newest first, so a gateway-timed-out scan can be found", async () => {
      const first = (await scan()).data.scan.id
      const second = (await scan()).data.scan.id
      const res = await api.get(`/admin/partners/${partnerId}/capabilities/scans`, adminHeaders)
      expect(res.status).toBe(200)
      expect(res.data.scans.map((s: any) => s.id)).toEqual([second, first])
      expect(res.data.scans[0]).toMatchObject({ kind: "records", status: "proposed", grouped_by: "fallback" })
      expect(res.data.scans[0].sample_count).toBeGreaterThan(0)
      expect(res.data.scans[0].proposal).toBeUndefined()
    })

    it("credits weave for supplied cloth once the partner has told us they weave", async () => {
      await (getContainer().resolve("partner_onboarding_profile") as any).createPartnerOnboardingProfiles({
        partner_id: partnerId,
        does_weaving: true,
      })
      const { proposal } = (await scan()).data.scan
      const fabric = proposal.samples.find((s: any) => s.product_type === "fabric")
      expect(fabric.actions).toEqual(["weave"])
    })
  })
})

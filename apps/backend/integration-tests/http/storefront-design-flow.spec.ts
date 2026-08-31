import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import {
  createApiKeysWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
} from "@medusajs/medusa/core-flows"
import {
  runListRawMaterials,
  runListPartners,
} from "../../src/mastra/agents/tools/storefront-design-catalog"
import { runGenerateDesignImage } from "../../src/mastra/agents/tools/storefront-design-flow"
import { PARTNER_MODULE } from "../../src/modules/partner"
import { DESIGN_MODULE } from "../../src/modules/designs"

jest.setTimeout(180 * 1000)

/**
 * Storefront design flow — the deterministic, non-LLM legs of the chat design
 * editor: fabric selection, partner selection, image generation, and the
 * on-the-fly reference analysis. These are the tool bodies the chat binds, so
 * they're exercised directly against the container (no model flakiness).
 *
 * Image generation uses the Mastra imagegen workflow, which in a test
 * environment returns a sample image when NO image-gen credentials are present
 * (the CI stub — no token needed) and does a REAL Cloudflare FLUX call when
 * CLOUDFLARE_AI_* / an `ai_image_gen` platform IS configured. Either way the
 * downstream pipeline (media upload → board canvases → thumbnail) runs for real.
 */

const SAMPLE_IMAGE_URL =
  process.env.SAMPLE_IMAGE_URL ||
  "https://picsum.photos/seed/jyt-garment/800/1000"

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Storefront design flow — fabrics, partners, generation, analysis", () => {
    let adminHeaders: Record<string, any>
    let storeHeaders: Record<string, any>
    let container: any

    beforeAll(async () => {
      container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      // Publishable key (required for /store/custom/* routes).
      const { result: apiKeys } = await createApiKeysWorkflow(container).run({
        input: {
          api_keys: [
            { type: "publishable", title: "Design Flow Test Key", created_by: "admin" },
          ],
        },
      })
      const pubKey = apiKeys[0]
      const storeService = container.resolve(Modules.STORE) as any
      const stores = await storeService.listStores({})
      if (stores?.[0]?.default_sales_channel_id) {
        await linkSalesChannelsToApiKeyWorkflow(container).run({
          input: { id: pubKey.id, add: [stores[0].default_sales_channel_id] },
        })
      }
      storeHeaders = { headers: { "x-publishable-api-key": pubKey.token } }

      // Seed a design-selectable fabric: inventory item + raw material link.
      const invRes = await api.post(
        "/admin/inventory-items",
        { title: "Indigo Cotton", description: "handwoven indigo cotton" },
        adminHeaders
      )
      const inventoryItemId = invRes.data.inventory_item.id
      const rawMaterialService = container.resolve("raw_materials") as any
      const rm = await rawMaterialService.createRawMaterials({
        name: "Indigo Handwoven Cotton",
        description: "natural slub",
        composition: "100% Cotton",
        color: "indigo",
        unit_of_measure: "Meter",
        status: "Active",
      })
      const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any
      await remoteLink.create([
        {
          [Modules.INVENTORY]: { inventory_item_id: inventoryItemId },
          raw_materials: { raw_materials_id: rm.id },
        },
      ])

      // Seed a verified manufacturer partner.
      const partnerService = container.resolve(PARTNER_MODULE) as any
      await partnerService.createPartners({
        name: "Weave & Sew Co",
        handle: `weave-sew-${Date.now()}`,
        status: "active",
        is_verified: true,
        workspace_type: "manufacturer",
      })
    })

    it("list_raw_materials returns the seeded fabric", async () => {
      const res = await runListRawMaterials(container, "indigo", 10)
      expect(res.materials.some((m: any) => m.name === "Indigo Handwoven Cotton")).toBe(true)
    })

    it("list_partners returns the seeded verified partner with its path role", async () => {
      const res = await runListPartners(container, "weave", 10)
      const hit = res.partners.find((p: any) => p.name === "Weave & Sew Co")
      expect(hit).toBeTruthy()
      expect(hit!.path).toBe("Manufacturer")
      expect(hit!.workspace_type).toBe("manufacturer")
    })

    it("generate_design_image produces two A/B takes and saves media + thumbnail", async () => {
      const result = await runGenerateDesignImage(container, {
        email: "flow@jyt.test",
        name: "Indigo Kurta",
        brief: {
          product_type: "kurta",
          concept_theme: "Indigo handwoven",
          aesthetic_keywords: ["handwoven", "natural"],
          color_palette: [{ name: "indigo", code: "#1e3a5f" }],
        },
        materials_prompt: "indigo handwoven cotton, natural slub",
        badges: { style: "relaxed", color_family: "indigo" },
      })

      expect(result.design_id).toBeTruthy()
      expect(result.created_design).toBe(true)
      expect(result.candidates).toHaveLength(2)
      expect(result.candidates[0].letter).toBe("A")
      expect(result.candidates[1].letter).toBe("B")
      for (const c of result.candidates) {
        expect(c.image_url).toBeTruthy()
        expect(c.prompt_used).toBeTruthy()
      }

      /**
       * 🔴 The prompt has to be about the GARMENT THEY ASKED FOR.
       *
       * `expect(prompt_used).toBeTruthy()` was the whole assertion, and it
       * passed while the generator produced a pastel pink blouse and a pastel
       * blue denim jacket for this indigo kurta brief — because the brief was
       * never passed to it and the enhancer's style context defaulted to the
       * literal string "casual fashion".
       *
       * A truthy string is not a correct one. This is the difference between
       * "an image came back" and "the design came back", and it is the only
       * thing the maker actually judges the feature on.
       *
       * ⚠️ Asserted on the GARMENT and nothing else. My first version of this
       * matched `/kurta|indigo|handwoven/` and passed with the brief removed —
       * because "indigo handwoven cotton" is also this fixture's
       * `materials_prompt`, which reaches the enhancer by a different route.
       * The alternation made the test agree with both versions of the code.
       * `kurta` comes from `brief.product_type` and from nowhere else.
       */
      const prompts = result.candidates.map((c) => c.prompt_used.toLowerCase())
      for (const p of prompts) {
        expect(p).toMatch(/kurta/)
      }

      // The design was persisted with its board canvases + a thumbnail.
      const designService = container.resolve(DESIGN_MODULE) as any
      const design = await designService.retrieveDesign(result.design_id)
      expect(design).toBeTruthy()
      expect(design.thumbnail_url).toBeTruthy()
      expect(design.moodboard).toBeTruthy()
    })

    /**
     * 🔴 The guard the fix above must NOT have weakened.
     *
     * `kind` is normalised to "initial" when absent, because the schema
     * defaults it and only the tool path parses. But an EXPLICIT revision with
     * no picked take still has nothing to iterate on, and generating anyway
     * would silently re-roll from the brief while telling the maker it built on
     * their pick — a different garment under the label of the one they chose.
     */
    it("🔴 an explicit revision with no picked take is still refused", async () => {
      await expect(
        runGenerateDesignImage(container, {
          email: "flow@jyt.test",
          name: "Indigo Kurta — revision",
          kind: "revision",
          change_request: "make the sleeves fuller",
          brief: {
            product_type: "kurta",
            concept_theme: "Indigo handwoven",
            aesthetic_keywords: ["handwoven"],
            color_palette: [{ name: "indigo", code: "#1e3a5f" }],
          },
        })
      ).rejects.toThrow(/Pick one of the takes first/)
    })

    it("analyzes a shared reference image and returns a shaped analysis", async () => {
      const res = await api.post(
        "/store/custom/design-assistant/references/analyze",
        { url: SAMPLE_IMAGE_URL },
        storeHeaders
      )

      expect(res.status).toBe(200)
      expect(res.data.url).toBe(SAMPLE_IMAGE_URL)
      // Best-effort vision: always a well-shaped object even when no vision
      // provider is configured (title/description empty strings, suggestions []).
      expect(res.data.analysis).toEqual(
        expect.objectContaining({
          title: expect.any(String),
          description: expect.any(String),
          suggestions: expect.any(Array),
        })
      )
    })
  })
})
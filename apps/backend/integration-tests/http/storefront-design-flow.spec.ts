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
import {
  runCreateDesign,
  runGenerateDesignImage,
  runGetDesignState,
  runSetActiveCanvas,
  findOpenChatDesign,
} from "../../src/mastra/agents/tools/storefront-design-flow"
import { runSaveMoodboard } from "../../src/mastra/agents/tools/storefront-design-moodboard"
import { verifyDesignAccessToken } from "../../src/lib/design-access/token"
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

    /**
     * #2543 phase 2: designs save and generate only for a SIGNED-IN customer
     * (the chat route reads it from the session into `context.customer_id`).
     * A verified buyer is a customer with an account.
     */
    const account = async (email: string): Promise<string> => {
      const customers: any = container.resolve(Modules.CUSTOMER)
      const [existing] = await customers.listCustomers({ email, has_account: true })
      if (existing) return existing.id
      return (await customers.createCustomers({ email, has_account: true })).id
    }
    const signedIn = async (email: string): Promise<any> => ({ customer_id: await account(email) })

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
      const result: any = await runGenerateDesignImage(container, {
        name: "Indigo Kurta",
        brief: {
          product_type: "kurta",
          concept_theme: "Indigo handwoven",
          aesthetic_keywords: ["handwoven", "natural"],
          color_palette: [{ name: "indigo", code: "#1e3a5f" }],
        },
        materials_prompt: "indigo handwoven cotton, natural slub",
        badges: { style: "relaxed", color_family: "indigo" },
      }, await signedIn("flow@jyt.test"))

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
      const prompts = result.candidates.map((c: any) => c.prompt_used.toLowerCase())
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
          name: "Indigo Kurta — revision",
          kind: "revision",
          change_request: "make the sleeves fuller",
          brief: {
            product_type: "kurta",
            concept_theme: "Indigo handwoven",
            aesthetic_keywords: ["handwoven"],
            color_palette: [{ name: "indigo", code: "#1e3a5f" }],
          },
        }, await signedIn("flow@jyt.test"))
      ).rejects.toThrow(/Pick one of the takes first/)
    })

    /**
     * ── #1689: two designs, 24 seconds apart, from one ask ──────────────
     *
     * `create_design` was documented as idempotent, and it was — against
     * `context.design_id`, which the CLIENT supplies after reading the
     * finished turn's tool output. So two calls inside one turn both saw an
     * empty context, and so did the next turn whenever the client failed to
     * read the id. Production: `01M1B2RS6ZM6P2HNCD8VZA9TBJ` and
     * `01M1B2SGY8RH06QBQJYYW44VHX`, same maker, same conversation.
     *
     * ⚠️ Each of these was run against the pre-fix code and FAILED there.
     */
    describe("🔴 one ask, one design", () => {
      const BRIEF = {
        product_type: "trousers",
        concept_theme: "Post-industrial lounge",
        aesthetic_keywords: ["utilitarian", "raw"],
        color_palette: [{ name: "slate", code: "#4a5259" }],
      }

      it("a second create_design in the SAME turn returns the first design", async () => {
        // The context object the route builds once per request and hands to
        // every tool factory — empty, exactly as it is on a first turn.
        const context: any = await signedIn("twice@jyt.test")

        const first: any = await runCreateDesign(
          container,
          { name: "Post-Industrial Lounge Trousers", brief: BRIEF },
          context
        )
        const second: any = await runCreateDesign(
          container,
          { name: "Post-Industrial Trousers", brief: BRIEF },
          context
        )

        expect(first.created).toBe(true)
        expect(second.created).toBe(false)
        expect(second.design_id).toBe(first.design_id)
        // The context was stamped — that is what makes the second call see it.
        expect(context.design_id).toBe(first.design_id)
      })

      /**
       * #2543: adopting "the maker's open design" from an email alone handed
       * any visitor who typed someone's email that maker's board AND a fresh
       * token for it. Only a signed-in session that IS the customer adopts.
       */
      it("a NEXT turn adopts the open design only for the signed-in customer", async () => {
        const first: any = await runCreateDesign(
          container,
          { name: "Indigo Kurta", brief: { ...BRIEF, product_type: "kurta" } },
          await signedIn("nextturn@jyt.test")
        )

        // A fresh request context (next turn): no design id carried.
        const second: any = await runCreateDesign(
          container,
          { name: "Indigo Kurta", brief: { ...BRIEF, product_type: "kurta" } },
          await signedIn("nextturn@jyt.test")
        )
        expect(second.created).toBe(false)
        expect(second.design_id).toBe(first.design_id)
        expect(verifyDesignAccessToken(second.design_token, first.design_id)).toBeTruthy()
      })

      /**
       * #2543 phase 2: a guest who types someone's email gets nothing at all
       * now — no design, no token, no guest customer under that address.
       */
      it("🔴 a guest typing someone's email gets sign_in_required, not their design", async () => {
        await runCreateDesign(
          container,
          { name: "Secret Kurta", brief: { ...BRIEF, product_type: "kurta" } },
          await signedIn("victim@jyt.test")
        )
        const attacker: any = await runCreateDesign(
          container,
          { email: "victim@jyt.test", name: "Mine now", brief: { ...BRIEF, product_type: "kurta" } } as any,
          { email: "victim@jyt.test" } as any
        )
        expect(attacker.sign_in_required).toBe(true)
        expect(attacker.design_id).toBeUndefined()
        expect(attacker.design_token).toBeUndefined()
      })

      it("generate_design_image lands on the design create_design just made (token carried)", async () => {
        const context: any = await signedIn("gen-once@jyt.test")

        const created: any = await runCreateDesign(
          container,
          { name: "Indigo Kurta", brief: { ...BRIEF, product_type: "kurta" } },
          context
        )
        expect(created.design_token).toBeTruthy()

        const generated: any = await runGenerateDesignImage(
          container,
          {
            name: "Indigo Kurta",
            brief: { ...BRIEF, product_type: "kurta" },
          },
          // The NEXT request's context, as the storefront now builds it: the
          // session's customer, the design id and the token it kept.
          {
            customer_id: context.customer_id,
            design_id: created.design_id,
            design_token: created.design_token,
          }
        )

        expect(generated.created_design).toBe(false)
        expect(generated.design_id).toBe(created.design_id)
        expect(generated.design_token).toBe(created.design_token)
        expect(generated.candidates).toHaveLength(2)
      })

      /**
       * 🔴 The bound that keeps "reuse the maker's design" from becoming
       * "hijack any design they own". A design that has moved past Conceptual
       * is in flight somewhere — a partner may already be quoting it — and a
       * new chat must never write takes onto it.
       */
      it("does NOT adopt a design that has left Conceptual", async () => {
        const context: any = await signedIn("moved-on@jyt.test")
        const created: any = await runCreateDesign(
          container,
          { name: "Sent Kurta", brief: { ...BRIEF, product_type: "kurta" } },
          context
        )

        const designService = container.resolve(DESIGN_MODULE) as any
        await designService.updateDesigns({
          id: created.design_id,
          status: "In_Development",
        })

        expect(await findOpenChatDesign(container, context.customer_id)).toBeNull()

        const next: any = await runCreateDesign(
          container,
          { name: "A new one", brief: { ...BRIEF, product_type: "kurta" } },
          await signedIn("moved-on@jyt.test")
        )
        expect(next.created).toBe(true)
        expect(next.design_id).not.toBe(created.design_id)
      })

      it("a maker with no design at all gets one", async () => {
        expect(await findOpenChatDesign(container, await account("brand-new@jyt.test"))).toBeNull()
      })
    })

    /**
     * ── #2543: every design-scoped tool checks the token / session ─────────
     *
     * The model passes `design_id` as a tool argument, and the model can be
     * talked into any id. Each tool must refuse a design the request's
     * credentials do not cover — before reading or writing anything.
     */
    describe("🔴 design-scoped tools refuse a design the request cannot prove", () => {
      const BRIEF = {
        product_type: "kurta",
        concept_theme: "Owned",
        aesthetic_keywords: ["plain"],
        color_palette: [{ name: "ecru", code: "#e8e0cf" }],
      }
      let owned: { design_id: string; design_token: string }
      let other: { design_id: string; design_token: string }
      let ownerId: string
      let otherId: string

      // beforeEach, not beforeAll: the runner restores the DB snapshot
      // before every test, which would erase designs made in a beforeAll.
      beforeEach(async () => {
        ownerId = await account("owner-2543@jyt.test")
        otherId = await account("other-2543@jyt.test")
        owned = (await runCreateDesign(
          container,
          { name: "Owned", brief: BRIEF },
          { customer_id: ownerId }
        )) as any
        other = (await runCreateDesign(
          container,
          { name: "Other", brief: BRIEF },
          { customer_id: otherId }
        )) as any
      })

      it("get_design_state: no token, another design's token → refused; own token → ok", async () => {
        await expect(
          runGetDesignState(container, owned.design_id, {})
        ).rejects.toThrow(/belongs to another session/)
        await expect(
          runGetDesignState(container, owned.design_id, { design_token: other.design_token })
        ).rejects.toThrow(/belongs to another session/)
        const state = await runGetDesignState(container, owned.design_id, {
          design_token: owned.design_token,
        })
        expect(state.design_id).toBe(owned.design_id)
      })

      it("set_active_canvas refuses without a token for that design", async () => {
        await expect(
          runSetActiveCanvas(
            container,
            { design_id: owned.design_id, canvas_id: "canvas_x" },
            { design_token: other.design_token }
          )
        ).rejects.toThrow(/belongs to another session/)
      })

      it("save_moodboard refuses without a token for that design", async () => {
        await expect(
          runSaveMoodboard(container, owned.design_id, [SAMPLE_IMAGE_URL], {
            token: other.design_token,
          })
        ).rejects.toThrow(/belongs to another session/)
      })

      it("generate_design_image refuses a model-supplied design id it cannot prove", async () => {
        await expect(
          runGenerateDesignImage(
            container,
            { design_id: owned.design_id, brief: BRIEF },
            { customer_id: otherId, design_token: other.design_token }
          )
        ).rejects.toThrow(/belongs to another session/)
      })

      it("a signed-in customer linked to the design is let in without a token", async () => {
        const state = await runGetDesignState(container, owned.design_id, { customer_id: ownerId })
        expect(state.design_id).toBe(owned.design_id)
        // …and a different signed-in customer is not.
        await expect(
          runGetDesignState(container, owned.design_id, { customer_id: otherId })
        ).rejects.toThrow(/belongs to another session/)
      })
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
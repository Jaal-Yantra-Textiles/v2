import FormData from "form-data"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { createAdminUser } from "../helpers/create-admin-user"
import { Modules } from "@medusajs/framework/utils"
import {
  createApiKeysWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
} from "@medusajs/medusa/core-flows"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import jwt from "jsonwebtoken"

import { DESIGN_MODULE } from "../../src/modules/designs"
import { verifyDesignAccessToken } from "../../src/lib/design-access/token"
import {
  runCreateDesign,
  runEnsureGuestCustomer,
} from "../../src/mastra/agents/tools/storefront-design-flow"

jest.setTimeout(240 * 1000)

/**
 * A maker drops photos into the design chat before saying anything.
 *
 * ## What this pins
 *
 * 🔴 Reference images never left the browser. The client presigned to S3 via a
 * CUSTOMER-authenticated endpoint, inside a flow whose makers are guests with
 * an email — so `presignDesignImageUpload` returned `AUTH_REQUIRED` before
 * making any request and every attachment degraded to a session-local object
 * URL. Production: **0 media files have ever carried
 * `metadata.source = "design-reference"`, 0 carry `vision_analysis`, and
 * designs created from those sessions have `moodboard.elements: 0`.**
 *
 * Nothing threw. The thumbnail rendered, the chat carried on, and the analysis
 * "failed" for want of a URL to read. It is the second place in this feature
 * where a guest flow reached for customer auth — the board read was the first
 * — and both degraded quietly, which is why no test caught either.
 *
 * The route under test takes the bytes server-side instead, so there is no
 * presign and no auth wall.
 */

// A tiny but REAL PNG. `uploadFilesWorkflow` writes bytes to disk, and a
// zero-byte or text payload would exercise a different path from a photograph.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
)

setupSharedTestSuite(() => {
  describe("POST /store/custom/design-assistant/references", () => {
    const container = () => getSharedTestEnv().getContainer()
    const email = `refs-${Date.now()}@jyt.test`

    let storeHeaders: Record<string, any>

    beforeAll(async () => {
      await createAdminUser(container())
      // Publishable key — required for every /store/custom/* route.
      const { result: apiKeys } = await createApiKeysWorkflow(container()).run({
        input: {
          api_keys: [
            { type: "publishable", title: "Design Refs Test Key", created_by: "admin" },
          ],
        },
      })
      const pubKey = apiKeys[0]
      const storeService = container().resolve(Modules.STORE) as any
      const stores = await storeService.listStores({})
      if (stores?.[0]?.default_sales_channel_id) {
        await linkSalesChannelsToApiKeyWorkflow(container()).run({
          input: { id: pubKey.id, add: [stores[0].default_sales_channel_id] },
        })
      }
      storeHeaders = { "x-publishable-api-key": pubKey.token }
    })

    /** A customer bearer exactly as the storefront forwards a signed-in session. */
    const customerBearer = (customerId: string) => ({
      authorization: `Bearer ${jwt.sign(
        { actor_id: customerId, actor_type: "customer", auth_identity_id: "authid_test_2543" },
        process.env.JWT_SECRET || "supersecret",
        { expiresIn: "1h" }
      )}`,
    })

    const upload = async (
      fields: Record<string, string>,
      files: Array<{ buf: Buffer; name: string; type?: string }>,
      extraHeaders: Record<string, string> = {}
    ) => {
      const { api } = getSharedTestEnv()
      const form = new FormData()
      for (const [k, v] of Object.entries(fields)) form.append(k, v)
      for (const f of files) {
        form.append("files", f.buf, {
          filename: f.name,
          contentType: f.type ?? "image/png",
        })
      }
      return api
        .post("/store/custom/design-assistant/references", form, {
          headers: { ...form.getHeaders(), ...storeHeaders, ...extraHeaders },
        })
        .catch((e: any) => e.response)
    }

    const designOf = async (designId: string) => {
      const service: any = container().resolve(DESIGN_MODULE)
      return await service.retrieveDesign(designId)
    }
    const sceneOf = async (designId: string) =>
      ((await designOf(designId))?.moodboard as any) ?? null

    it("🔴 photos with no brief CREATE the design and land on its board", async () => {
      const res = await upload({ customer_email: email }, [
        { buf: PNG_1X1, name: "jacket-front.png" },
        { buf: PNG_1X1, name: "jacket-back.png" },
      ])

      expect([res.status, String(res.data?.message ?? "")]).toEqual([201, ""])
      expect(res.data.created_design).toBe(true)
      expect(res.data.design_id).toBeTruthy()
      expect(res.data.references).toHaveLength(2)

      for (const ref of res.data.references) {
        // The whole point: a PUBLIC url that exists server-side, not an object
        // URL that dies with the tab.
        expect(ref.url).toMatch(/^http/)
      }

      // And they are ON the board — the thing that was empty on every
      // production design created this way.
      const scene = await sceneOf(res.data.design_id)
      const inspirations = (scene?.elements ?? []).filter(
        (el: any) => el?.customData?.source === "inspiration"
      )
      expect(inspirations).toHaveLength(2)

      // 🔑 And in the design's GALLERY, which is what the admin design page
      // and the design detail read. The board alone would leave the photos
      // visible in the chat and invisible everywhere the business looks.
      const design = await designOf(res.data.design_id)
      expect(design.media_files).toHaveLength(2)
      for (const m of design.media_files as any[]) {
        expect(m.url).toMatch(/^http/)
      }
    })

    it("adds to an EXISTING design rather than minting a second", async () => {
      const first = await upload({ customer_email: email }, [
        { buf: PNG_1X1, name: "a.png" },
      ])
      expect(first.status).toBe(201)

      // #2543: the new design's token comes back with it, and adding to the
      // design needs it.
      expect(
        verifyDesignAccessToken(first.data.design_token, first.data.design_id)
      ).toBeTruthy()

      const second = await upload(
        { customer_email: email, design_id: first.data.design_id },
        [{ buf: PNG_1X1, name: "b.png" }],
        { "x-design-token": first.data.design_token }
      )

      expect(second.status).toBe(201)
      expect(second.data.created_design).toBe(false)
      expect(second.data.design_id).toBe(first.data.design_id)

      // 🔑 Two designs from one maker's uploads is the #1689 duplicate-design
      // complaint arriving by a different door.
      const scene = await sceneOf(first.data.design_id)
      const inspirations = (scene?.elements ?? []).filter(
        (el: any) => el?.customData?.source === "inspiration"
      )
      expect(inspirations).toHaveLength(2)
    })

    /**
     * 🔴 #1689, through the upload door.
     *
     * The chat mints the design the moment the brief locks, and the client
     * only learns its id from the finished turn's tool output. A maker who
     * drags photos in before that lands sends no `design_id` — and this route
     * used to mint a SECOND design beside the one they were talking to.
     *
     * 🔴 #2543: adoption by email alone handed any visitor a stranger's open
     * board. It now happens only for the SIGNED-IN customer who owns it; a
     * guest with just the email gets a new design of their own.
     */
    describe("open chat design, no design_id sent", () => {
      const brief = {
        product_type: "kurta",
        concept_theme: "Indigo handwoven",
        aesthetic_keywords: ["handwoven"],
        color_palette: [{ name: "indigo", code: "#1e3a5f" }],
      }

      it("pins onto it for the signed-in customer who owns it", async () => {
        const openEmail = `open-${Date.now()}@jyt.test`
        const created = await runCreateDesign(
          container(),
          { email: openEmail, name: "Indigo Kurta", brief },
          undefined
        )
        const { customer_id } = await runEnsureGuestCustomer(container(), openEmail)

        const res = await upload(
          { customer_email: openEmail },
          [{ buf: PNG_1X1, name: "swatch.png" }],
          customerBearer(customer_id)
        )

        expect(res.status).toBe(201)
        expect(res.data.created_design).toBe(false)
        expect(res.data.design_id).toBe(created.design_id)
        expect(verifyDesignAccessToken(res.data.design_token, created.design_id)).toBeTruthy()
      })

      it("🔴 does NOT hand a guest who types the email the owner's board", async () => {
        const openEmail = `open-guest-${Date.now()}@jyt.test`
        const created = await runCreateDesign(
          container(),
          { email: openEmail, name: "Indigo Kurta", brief },
          undefined
        )

        const res = await upload({ customer_email: openEmail }, [
          { buf: PNG_1X1, name: "swatch.png" },
        ])

        expect(res.status).toBe(201)
        expect(res.data.created_design).toBe(true)
        expect(res.data.design_id).not.toBe(created.design_id)
        expect(verifyDesignAccessToken(res.data.design_token, created.design_id)).toBeNull()
      })
    })

    /**
     * The client merges each returned analysis back onto the file it came
     * from BY NAME, so `name` echoing the uploaded filename is part of the
     * contract, not decoration. Without it the wrong description lands on the
     * wrong photo — silently, since both are strings.
     */
    it("echoes each uploaded filename so the client can match them back", async () => {
      const res = await upload({ customer_email: `names-${Date.now()}@jyt.test` }, [
        { buf: PNG_1X1, name: "front.png" },
        { buf: PNG_1X1, name: "back.png" },
      ])

      expect(res.status).toBe(201)
      expect(res.data.references.map((r: any) => r.name)).toEqual([
        "front.png",
        "back.png",
      ])
    })

    it("🔴 refuses a design the caller holds no token for (403, nothing pinned)", async () => {
      const mine = await upload({ customer_email: email }, [
        { buf: PNG_1X1, name: "mine.png" },
      ])
      expect(mine.status).toBe(201)
      const other = await upload({ customer_email: `other-${Date.now()}@jyt.test` }, [
        { buf: PNG_1X1, name: "other.png" },
      ])
      expect(other.status).toBe(201)
      const before = (await sceneOf(mine.data.design_id))?.elements?.length ?? 0

      // A design_id in a public body is a string anyone can type — and so is
      // the owner's email (#2543).
      const noToken = await upload(
        { customer_email: email, design_id: mine.data.design_id },
        [{ buf: PNG_1X1, name: "theirs.png" }]
      )
      expect(noToken.status).toBe(403)

      // A real token — for a DIFFERENT design.
      const wrongToken = await upload(
        { customer_email: email, design_id: mine.data.design_id },
        [{ buf: PNG_1X1, name: "theirs.png" }],
        { "x-design-token": other.data.design_token }
      )
      expect(wrongToken.status).toBe(403)

      // A tampered token.
      const tampered = await upload(
        { customer_email: email, design_id: mine.data.design_id },
        [{ buf: PNG_1X1, name: "theirs.png" }],
        { "x-design-token": `${mine.data.design_token.slice(0, -2)}xx` }
      )
      expect(tampered.status).toBe(403)

      const after = (await sceneOf(mine.data.design_id))?.elements?.length ?? 0
      expect(after).toBe(before)
    })

    it("requires an email, and requires an image", async () => {
      const noEmail = await upload({}, [{ buf: PNG_1X1, name: "x.png" }])
      expect(noEmail.status).toBe(400)

      const noFiles = await upload({ customer_email: email }, [])
      expect(noFiles.status).toBe(400)

      // A PDF is not a reference photograph.
      const notAnImage = await upload({ customer_email: email }, [
        { buf: Buffer.from("%PDF-1.4"), name: "spec.pdf", type: "application/pdf" },
      ])
      expect(notAnImage.status).toBe(400)
    })
  })
})

import { Modules } from "@medusajs/framework/utils"
import {
  createApiKeysWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
} from "@medusajs/medusa/core-flows"

import { createAdminUser } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import designCustomerLink from "../../src/links/design-customer-link"
import { createDesignWorkflow } from "../../src/workflows/designs/create-design"
import {
  runCreateDesign,
  runGenerateDesignImage,
  isSignInRequired,
} from "../../src/mastra/agents/tools/storefront-design-flow"
import { mintDesignAccessToken } from "../../src/lib/design-access/token"
import { OTP_MAX_ATTEMPTS } from "../../src/modules/email-otp-auth/otp-code"

jest.setTimeout(240 * 1000)

/**
 * #2543 phase 2 — passwordless email sign-in for design-studio buyers.
 *
 * `POST /auth/customer/email-otp` is the stock Medusa auth route driving the
 * custom `email-otp` provider. The code reaches the buyer by email; here the
 * test environment's `notification-local` provider persists every send, so
 * the test reads the code back from the notification row — the same way a
 * buyer reads it from their inbox. No real email is sent.
 */

const decodeJwt = (token: string): Record<string, any> =>
  JSON.parse(Buffer.from(token.split(".")[1], "base64").toString("utf-8"))

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let ipSeq = 0
/** A fresh client IP per test — the per-IP send cap is process-wide. */
const freshIp = () => `10.43.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`
const uniqueEmail = (tag: string) =>
  `otp-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@jyt.test`

const BRIEF = {
  product_type: "kurta",
  concept_theme: "Indigo handwoven",
  aesthetic_keywords: ["handwoven"],
  color_palette: [{ name: "indigo", code: "#1e3a5f" }],
}

setupSharedTestSuite(() => {
  describe("Design studio email sign-in (email-otp)", () => {
    const env = () => getSharedTestEnv()
    const container = () => env().getContainer()
    let pubKey: string

    beforeAll(async () => {
      await createAdminUser(container())
      const { result: apiKeys } = await createApiKeysWorkflow(container()).run({
        input: {
          api_keys: [{ type: "publishable", title: "OTP Test Key", created_by: "admin" }],
        },
      })
      pubKey = apiKeys[0].token
      const stores = await (container().resolve(Modules.STORE) as any).listStores({})
      if (stores?.[0]?.default_sales_channel_id) {
        await linkSalesChannelsToApiKeyWorkflow(container()).run({
          input: { id: apiKeys[0].id, add: [stores[0].default_sales_channel_id] },
        })
      }
    })

    const otp = (body: Record<string, unknown>, ip: string) =>
      env()
        .api.post("/auth/customer/email-otp", body, { headers: { "x-forwarded-for": ip } })
        .catch((e: any) => e.response)

    /** The code from the email the buyer was sent (latest one). */
    const codeFromEmail = async (email: string, after = 0): Promise<string> => {
      const notifications: any = container().resolve(Modules.NOTIFICATION)
      for (let i = 0; i < 50; i++) {
        const rows: any[] = await notifications.listNotifications(
          { to: email, template: "customer-login-code" },
          { order: { created_at: "DESC" } }
        )
        if (rows.length > after) return rows[0].data.code
        await sleep(100)
      }
      throw new Error(`no sign-in code email reached ${email}`)
    }

    const sentSoFar = async (email: string) => {
      const notifications: any = container().resolve(Modules.NOTIFICATION)
      return (await notifications.listNotifications({ to: email, template: "customer-login-code" })).length
    }

    const sendCode = async (email: string, ip = freshIp()) => {
      const after = await sentSoFar(email)
      const res = await otp({ email }, ip)
      expect(res.status).toBe(401)
      expect(res.data.message).toBe("code_sent")
      return codeFromEmail(email, after)
    }

    const otpIdentity = async (email: string) => {
      const auth: any = container().resolve(Modules.AUTH)
      const [identity] = await auth.listProviderIdentities({ entity_id: email, provider: "email-otp" })
      return identity
    }

    const signIn = async (email: string) => {
      const ip = freshIp()
      const code = await sendCode(email, ip)
      const res = await otp({ email, code }, ip)
      expect(res.status).toBe(200)
      return res.data.token as string
    }

    const complete = (token: string) =>
      env()
        .api.post(
          "/store/custom/auth/email-otp/complete",
          {},
          { headers: { authorization: `Bearer ${token}`, "x-publishable-api-key": pubKey } }
        )
        .catch((e: any) => e.response)

    const refresh = async (token: string) => {
      const res = await env().api.post(
        "/auth/token/refresh",
        {},
        { headers: { authorization: `Bearer ${token}` } }
      )
      return res.data.token as string
    }

    const linkedCustomers = async (designId: string) => {
      const query: any = container().resolve("query")
      const { data } = await query.graph({
        entity: designCustomerLink.entryPoint,
        fields: ["design_id", "customer_id"],
        filters: { design_id: designId },
      })
      return (data as any[]).map((l) => l?.customer_id).filter(Boolean).sort()
    }

    it("sends a code by email and stores only its hash", async () => {
      const email = uniqueEmail("send")
      const code = await sendCode(email)

      expect(code).toMatch(/^\d{6}$/)
      const identity = await otpIdentity(email)
      expect(identity.provider_metadata.code_hash).toMatch(/^scrypt\$/)
      expect(JSON.stringify(identity.provider_metadata)).not.toContain(code)
      expect(identity.provider_metadata.attempts).toBe(0)
    })

    it("answers a known and an unknown email the same way", async () => {
      const known = uniqueEmail("known")
      await signIn(known)
      const a = await otp({ email: known }, freshIp())
      const b = await otp({ email: uniqueEmail("unknown") }, freshIp())
      expect([a.status, a.data.message]).toEqual([b.status, b.data.message])
    })

    it("refuses a wrong code", async () => {
      const email = uniqueEmail("wrong")
      const ip = freshIp()
      const code = await sendCode(email, ip)
      const res = await otp({ email, code: code === "000000" ? "111111" : "000000" }, ip)
      expect(res.status).toBe(401)
      expect(res.data.message).toBe("invalid_code")
      expect((await otpIdentity(email)).provider_metadata.attempts).toBe(1)
    })

    it("refuses an expired code, even the right one", async () => {
      const email = uniqueEmail("expired")
      const ip = freshIp()
      const code = await sendCode(email, ip)

      const auth: any = container().resolve(Modules.AUTH)
      const identity = await otpIdentity(email)
      await auth.updateProviderIdentities({
        id: identity.id,
        provider_metadata: {
          ...identity.provider_metadata,
          expires_at: new Date(Date.now() - 1000).toISOString(),
        },
      })

      const res = await otp({ email, code }, ip)
      expect(res.status).toBe(401)
      expect(res.data.message).toBe("code_expired")
    })

    it(`🔴 locks the code after ${OTP_MAX_ATTEMPTS} wrong guesses — the right code then fails`, async () => {
      const email = uniqueEmail("lockout")
      const ip = freshIp()
      const code = await sendCode(email, ip)
      const wrong = code === "000000" ? "111111" : "000000"

      const messages: string[] = []
      for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
        messages.push((await otp({ email, code: wrong }, ip)).data.message)
      }
      expect(messages.slice(0, -1).every((m) => m === "invalid_code")).toBe(true)
      expect(messages.at(-1)).toBe("too_many_attempts")

      const right = await otp({ email, code }, ip)
      expect(right.status).toBe(401)
      expect(right.data.message).toBe("invalid_code")
    })

    it("a code works once; sign-in → customer account → customer token", async () => {
      const email = uniqueEmail("success")
      const ip = freshIp()
      const code = await sendCode(email, ip)

      const ok = await otp({ email, code }, ip)
      expect(ok.status).toBe(200)
      const registration = ok.data.token as string
      // First time: an auth identity but no customer yet (registration token).
      expect(decodeJwt(registration).actor_id || "").toBe("")

      const replay = await otp({ email, code }, ip)
      expect(replay.status).toBe(401)

      const done = await complete(registration)
      expect(done.status).toBe(200)
      expect(done.data.created_customer).toBe(true)
      expect(done.data.email).toBe(email)

      const token = await refresh(registration)
      expect(decodeJwt(token).actor_id).toBe(done.data.customer_id)

      const me = await env().api.get("/store/customers/me", {
        headers: { authorization: `Bearer ${token}`, "x-publishable-api-key": pubKey },
      })
      expect(me.data.customer.email).toBe(email)
      expect(me.data.customer.has_account).toBe(true)

      // A second sign-in goes straight to a customer token, same customer.
      const second = await signIn(email)
      expect(decodeJwt(second).actor_id).toBe(done.data.customer_id)
      const again = await complete(second)
      expect(again.data.customer_id).toBe(done.data.customer_id)
      expect(again.data.created_customer).toBe(false)
    })

    it("signs an existing account holder into THEIR account", async () => {
      const email = uniqueEmail("existing")
      const customers: any = container().resolve(Modules.CUSTOMER)
      const account = await customers.createCustomers({ email, has_account: true })

      const done = await complete(await signIn(email))
      expect(done.status).toBe(200)
      expect(done.data.customer_id).toBe(account.id)
      expect(done.data.created_customer).toBe(false)
    })

    it("🔴 adopts the buyer's GUEST studio designs — and only those", async () => {
      const email = uniqueEmail("adopt")
      const customers: any = container().resolve(Modules.CUSTOMER)
      const guest = await customers.createCustomers({ email, has_account: false })

      const makeDesign = async (name: string, tags: string[]) => {
        const { result } = await createDesignWorkflow(container()).run({
          input: {
            name,
            description: "",
            design_type: "Custom",
            status: "Conceptual",
            customer_id_for_link: guest.id,
            tags,
          } as any,
        })
        return (result as any).id as string
      }
      const studio = await makeDesign("Studio kurta", ["custom", "customer-design", "chat-editor"])
      const adminLinked = await makeDesign("Order design", ["custom"])

      const done = await complete(await signIn(email))
      expect(done.status).toBe(200)
      const customerId = done.data.customer_id
      expect(done.data.adopted_design_ids).toEqual([studio])

      expect(await linkedCustomers(studio)).toEqual([customerId])
      // An admin-linked design stays with the guest it was filed under.
      expect(await linkedCustomers(adminLinked)).toEqual([guest.id])
      // The guest row is left alone.
      expect(await customers.retrieveCustomer(guest.id)).toBeTruthy()

      // Idempotent: nothing left to adopt, links unchanged.
      const again = await complete(await signIn(email))
      expect(again.data.adopted_design_ids).toEqual([])
      expect(await linkedCustomers(studio)).toEqual([customerId])
    })

    it("refuses /complete for a token that did not come from an email code", async () => {
      // An emailpass registration proves nothing about the address.
      const email = uniqueEmail("emailpass")
      const reg = await env().api.post("/auth/customer/emailpass/register", {
        email,
        password: "supersecret",
      })
      const res = await complete(reg.data.token)
      expect(res.status).toBe(400)
    })

    it("caps code sends per email (429 + Retry-After)", async () => {
      const email = uniqueEmail("ratelimit")
      const statuses: number[] = []
      let retryAfter: string | undefined
      for (let i = 0; i < 4; i++) {
        const res = await otp({ email }, freshIp())
        statuses.push(res.status)
        retryAfter = res.headers?.["retry-after"]
      }
      expect(statuses).toEqual([401, 401, 401, 429])
      expect(Number(retryAfter)).toBeGreaterThan(0)
    })

    it("POST /design-assistant/designs: the signed-in buyer's open studio design, guests refused", async () => {
      const email = uniqueEmail("studio")
      const done = await complete(await signIn(email))
      const token = await refresh((await signIn(email)))
      const headers = { authorization: `Bearer ${token}`, "x-publishable-api-key": pubKey }

      const first = await env().api.post("/store/custom/design-assistant/designs", {}, { headers })
      expect(first.status).toBe(201)
      expect(first.data.created).toBe(true)
      expect(await linkedCustomers(first.data.design_id)).toEqual([done.data.customer_id])

      const again = await env().api.post("/store/custom/design-assistant/designs", {}, { headers })
      expect(again.status).toBe(200)
      expect(again.data.design_id).toBe(first.data.design_id)

      const guest = await env()
        .api.post("/store/custom/design-assistant/designs", {}, { headers: { "x-publishable-api-key": pubKey } })
        .catch((e: any) => e.response)
      expect(guest.status).toBe(401)
    })

    describe("🔴 chat tools need a signed-in buyer", () => {
      it("create_design without a session returns sign_in_required and creates nothing", async () => {
        const email = uniqueEmail("typed")
        const res = await runCreateDesign(
          container(),
          { name: "Typed", brief: BRIEF, ...({ email } as any) },
          { email } as any
        )
        expect(isSignInRequired(res)).toBe(true)

        // The old path find-or-created a guest customer from the typed email.
        const customers: any = container().resolve(Modules.CUSTOMER)
        expect(await customers.listCustomers({ email })).toHaveLength(0)
      })

      it("generate_design_image without a session returns sign_in_required — a design token is not enough", async () => {
        const customers: any = container().resolve(Modules.CUSTOMER)
        const owner = await customers.createCustomers({ email: uniqueEmail("gen"), has_account: true })
        const created: any = await runCreateDesign(
          container(),
          { name: "Owned", brief: BRIEF },
          { customer_id: owner.id }
        )
        expect(created.design_id).toBeTruthy()

        const res = await runGenerateDesignImage(
          container(),
          { design_id: created.design_id, brief: BRIEF },
          { design_id: created.design_id, design_token: created.design_token }
        )
        expect(isSignInRequired(res)).toBe(true)

        // Signed in, but not linked to the design: refused too.
        const stranger = await customers.createCustomers({ email: uniqueEmail("stranger"), has_account: true })
        await expect(
          runGenerateDesignImage(
            container(),
            { design_id: created.design_id, brief: BRIEF },
            {
              customer_id: stranger.id,
              design_token: mintDesignAccessToken(created.design_id, owner.id),
            }
          )
        ).rejects.toThrow(/belongs to another session/)
      })
    })
  })
})

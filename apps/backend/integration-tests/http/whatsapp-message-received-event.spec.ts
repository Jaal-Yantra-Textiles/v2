import crypto from "crypto"
import { Modules } from "@medusajs/framework/utils"
import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser } from "../helpers/create-admin-user"

// W3 — the webhook must emit `whatsapp.message_received` for every parsed
// inbound message so the visual-flow-event-trigger subscriber can fan out to
// flows configured against this event (e.g. WhatsApp → product draft).
//
// Signed POSTs are accepted when the X-Hub-Signature-256 HMAC matches any
// known app secret. The simplest known secret in tests is the env-var one,
// so we set it before the suite boots.
const TEST_APP_SECRET = "w3_test_app_secret"
process.env.WHATSAPP_APP_SECRET = TEST_APP_SECRET

const TEST_PHONE = "919876512345"

jest.setTimeout(60 * 1000)

function signBody(rawBody: string, secret: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex")
}

function buildInboundTextPayload(phone: string, messageId: string, text: string) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "wabai_test",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15555550000", phone_number_id: "phone_test_1" },
              contacts: [{ profile: { name: "Tester" }, wa_id: phone }],
              messages: [
                {
                  id: messageId,
                  from: phone,
                  type: "text",
                  text: { body: text },
                  timestamp: String(Math.floor(Date.now() / 1000)),
                },
              ],
            },
          },
        ],
      },
    ],
  }
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("WhatsApp webhook — emits whatsapp.message_received", () => {
    beforeAll(async () => {
      await createAdminUser(getContainer())

      // Register a partner whose admin phone matches the inbound sender, so
      // the webhook resolves partner_id on the event payload.
      const unique = Date.now()
      const email = `wa-event-${unique}@jyt.test`

      await api.post("/auth/partner/emailpass/register", {
        email,
        password: "supersecret",
      })
      const login = await api.post("/auth/partner/emailpass", {
        email,
        password: "supersecret",
      })

      await api.post(
        "/partners",
        {
          name: `WA Event Partner ${unique}`,
          handle: `wa-event-${unique}`,
          admin: { email, first_name: "Event", last_name: "Tester", phone: TEST_PHONE },
        },
        { headers: { Authorization: `Bearer ${login.data.token}` } }
      )
    })

    it("subscriber config registers whatsapp.message_received", async () => {
      const mod = await import("../../src/subscribers/visual-flow-event-trigger")
      const events = mod.config?.event
      const list = Array.isArray(events) ? events : [events]
      expect(list).toContain("whatsapp.message_received")
    })

    it("fires the event when a signed inbound text message arrives", async () => {
      const eventBus = getContainer().resolve(Modules.EVENT_BUS) as any

      const received = new Promise<any>((resolve) => {
        const subscriber = async (evt: any) => {
          eventBus.unsubscribe("whatsapp.message_received", subscriber)
          resolve(evt)
        }
        eventBus.subscribe("whatsapp.message_received", subscriber, {
          subscriberId: `w3-test-${Date.now()}`,
        })
      })

      const messageId = `wamid.test_${Date.now()}`
      const payload = buildInboundTextPayload(TEST_PHONE, messageId, "hello from W3")
      const rawBody = JSON.stringify(payload)

      const res = await api.post("/webhooks/social/whatsapp", rawBody, {
        headers: {
          "Content-Type": "application/json",
          "X-Hub-Signature-256": signBody(rawBody, TEST_APP_SECRET),
        },
        validateStatus: () => true,
        transformRequest: [(data: any) => data],
      })

      expect(res.status).toBe(200)
      expect(res.data).toBe("EVENT_RECEIVED")

      const evt = await Promise.race([
        received,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("timed out waiting for whatsapp.message_received")), 8000)
        ),
      ])

      // Subscribers receive Event<T> = { name, data, metadata? }
      expect(evt.name).toBe("whatsapp.message_received")
      const data = evt.data
      expect(data.from).toBe(TEST_PHONE)
      expect(data.type).toBe("text")
      expect(data.text).toBe("hello from W3")
      expect(data.message_id).toBe(messageId)
      expect(data.media_ids).toEqual([])
      expect(typeof data.partner_id === "string" || data.partner_id === null).toBe(true)
    })
  })
})

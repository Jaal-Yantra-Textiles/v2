/**
 * Partner email verification (native Medusa 2.16+ auth verification).
 *
 * This spec runs its OWN Medusa instance via medusaIntegrationTestRunner and
 * flips PARTNER_EMAIL_VERIFICATION=true *before boot* so the partner actor
 * requires email verification here without affecting the shared partner suite
 * (which leaves the flag unset → verification disabled).
 *
 * Run:
 *   TEST_TYPE=integration:http NODE_OPTIONS="--experimental-vm-modules" \
 *     npx jest --testPathPattern="partner-email-verification" --runInBand --forceExit
 */

// Must be set before the runner boots so medusa-config reads it.
process.env.PARTNER_EMAIL_VERIFICATION = "true"

import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"
import { partnerEmailTemplates } from "../../src/scripts/seed-partner-email-templates"
import { EMAIL_TEMPLATES_MODULE } from "../../src/modules/email_templates"

jest.setTimeout(120000)

const PASSWORD = "supersecret"

const decodeJwt = (token: string): Record<string, any> => {
  const [, payload] = token.split(".")
  return JSON.parse(Buffer.from(payload, "base64").toString("utf-8"))
}

const uniqueEmail = () =>
  `verify-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@medusa-test.com`

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    beforeAll(async () => {
      // Ensure the verification email template exists so the subscriber's
      // send workflow can resolve it.
      const svc: any = getContainer().resolve(EMAIL_TEMPLATES_MODULE)
      const tpl = partnerEmailTemplates.find(
        (t) => t.template_key === "partner-email-verification"
      )
      try {
        await svc.getTemplateByKey("partner-email-verification")
      } catch {
        await svc.createEmailTemplates([tpl])
      }
    })

    describe("POST /auth/partner/emailpass (verification gating)", () => {
      it("gates an unverified partner and completes the native verify flow", async () => {
        const email = uniqueEmail()

        // 1. Register the auth identity.
        await api.post("/auth/partner/emailpass/register", {
          email,
          password: PASSWORD,
        })

        // 2. First login → gated: verification required + actorless token.
        const login1 = await api.post("/auth/partner/emailpass", {
          email,
          password: PASSWORD,
        })
        expect(login1.data.verification_required).toBe(true)
        expect(typeof login1.data.token).toBe("string")

        const token1 = login1.data.token as string
        const claims1 = decodeJwt(token1)
        // Actorless token: auth identity present, but no partner actor yet.
        expect(claims1.auth_identity_id).toBeTruthy()
        expect(claims1.actor_id === "" || claims1.actor_id == null).toBe(true)

        // 3. Create the partner record (allowed pre-verification via
        //    allowUnregistered) so re-login can mint a real actor token.
        const partnerRes = await api.post(
          "/partners",
          {
            name: `Verify Co ${Date.now()}`,
            handle: `verify-${Date.now()}`,
            admin: { email, first_name: "Ada", last_name: "Weaver" },
          },
          { headers: { Authorization: `Bearer ${token1}` } }
        )
        const partnerId = partnerRes.data.partner.id
        expect(partnerId).toBeTruthy()

        // 4. Obtain a real code via the auth module (the HTTP request route
        //    intentionally never returns the raw code).
        const authService: any = getContainer().resolve(Modules.AUTH)
        const requested = await authService.requestAuthVerification({
          auth_identity_id: claims1.auth_identity_id,
          entity_id: email,
          entity_type: "email",
          code_provider: "token",
        })
        expect(typeof requested.code).toBe("string")

        // 5. Confirm over HTTP — no auth header needed (allowUnauthenticated).
        const confirm = await api.post("/auth/verification/confirm", {
          code: requested.code,
          code_provider: "token",
        })
        expect(confirm.status).toBe(200)
        expect(confirm.data.entity_id).toBe(email)
        expect(confirm.data.verified_at).toBeTruthy()

        // 6. Re-login → now a real actor token, no verification gate.
        const login2 = await api.post("/auth/partner/emailpass", {
          email,
          password: PASSWORD,
        })
        expect(login2.data.verification_required).toBeFalsy()
        expect(typeof login2.data.token).toBe("string")
        const claims2 = decodeJwt(login2.data.token)
        expect(claims2.actor_type).toBe("partner")
        expect(claims2.actor_id).toBe(partnerId)
      })

      it("rejects an invalid or reused code", async () => {
        const bad = await api
          .post("/auth/verification/confirm", {
            code: "definitely-not-a-real-code",
            code_provider: "token",
          })
          .catch((e: any) => e.response)
        expect(bad.status).toBeGreaterThanOrEqual(400)
      })
    })

    describe("auth.verification_requested subscriber", () => {
      it("sends the partner-email-verification email on /auth/verification/request", async () => {
        const email = uniqueEmail()
        await api.post("/auth/partner/emailpass/register", {
          email,
          password: PASSWORD,
        })
        const login = await api.post("/auth/partner/emailpass", {
          email,
          password: PASSWORD,
        })
        const token = login.data.token as string

        const requestRes = await api.post(
          "/auth/verification/request",
          {
            entity_id: email,
            entity_type: "email",
            code_provider: "token",
            metadata: { actor_type: "partner" },
          },
          { headers: { Authorization: `Bearer ${token}` } }
        )
        expect(requestRes.status).toBe(201)
        // The raw code is never echoed back.
        expect(requestRes.data.verification?.code).toBeUndefined()

        // The subscriber runs on the (local) event bus; poll notifications.
        const notificationService: any = getContainer().resolve(
          Modules.NOTIFICATION
        )
        let found: any
        for (let i = 0; i < 20 && !found; i++) {
          const notifications = await notificationService.listNotifications({
            to: email,
          })
          found = (notifications || []).find(
            (n: any) => n.template === "partner-email-verification"
          )
          if (!found) {
            await new Promise((r) => setTimeout(r, 250))
          }
        }
        expect(found).toBeTruthy()
      })
    })
  },
})

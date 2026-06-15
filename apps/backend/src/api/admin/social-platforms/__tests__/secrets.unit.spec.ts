/**
 * Unit test — social-platforms secret handling (#32A API hardening)
 *
 * The admin social-platforms API used to echo back raw credentials in
 * `api_config`. These cover the three guarantees in secrets.ts:
 *   - redact: no plaintext OR ciphertext leaves the API by default
 *   - reveal: a raw secret only comes back for an MFA-enabled caller that asks
 *   - preserve: a blank-field save restores omitted secrets server-side
 *
 * Run:
 *   TEST_TYPE=unit npx jest --testPathPattern="social-platforms/__tests__/secrets"
 */
import { Modules } from "@medusajs/framework/utils"
import {
  redactApiConfig,
  preserveExistingSecrets,
  isSecretRevealAllowed,
} from "../secrets"

describe("redactApiConfig (#32A)", () => {
  const fullConfig = {
    provider: "whatsapp",
    phone_number_id: "123",
    waba_id: "456",
    access_token: "PLAINTEXT-TOKEN",
    access_token_encrypted: { enc: "v1:abc" },
    app_secret: "PLAINTEXT-SECRET",
    webhook_verify_token: "VERIFY",
    templates: [{ name: "t1" }],
  }

  it("strips plaintext AND ciphertext, keeps non-secret config, adds presence flags", () => {
    const out = redactApiConfig(fullConfig)!
    // Secrets gone (both shapes)…
    expect(out.access_token).toBeUndefined()
    expect(out.access_token_encrypted).toBeUndefined()
    expect(out.app_secret).toBeUndefined()
    expect(out.webhook_verify_token).toBeUndefined()
    // …presence preserved for the UI…
    expect(out.access_token_present).toBe(true)
    expect(out.app_secret_present).toBe(true)
    // …non-secret config untouched.
    expect(out.phone_number_id).toBe("123")
    expect(out.waba_id).toBe("456")
    expect(out.templates).toEqual([{ name: "t1" }])
  })

  it("does not mutate the input", () => {
    const copy = JSON.parse(JSON.stringify(fullConfig))
    redactApiConfig(fullConfig)
    expect(fullConfig).toEqual(copy)
  })

  it("reveals the decrypted token (and only then) when reveal=true", () => {
    const fakeEncryption: any = {
      decrypt: (d: any) => (d?.enc === "v1:abc" ? "PLAINTEXT-TOKEN" : null),
    }
    const out = redactApiConfig(fullConfig, { reveal: true, encryptionService: fakeEncryption })!
    expect(out.access_token).toBe("PLAINTEXT-TOKEN")
    // Ciphertext blob is dropped from a revealed response.
    expect(out.access_token_encrypted).toBeUndefined()
  })

  it("passes through null/empty config unchanged", () => {
    expect(redactApiConfig(null)).toBeNull()
    expect(redactApiConfig(undefined)).toBeUndefined()
  })
})

describe("preserveExistingSecrets (#32A)", () => {
  it("restores omitted/blank secrets from the existing row", () => {
    const existing = {
      provider: "whatsapp",
      access_token_encrypted: { enc: "v1:keep" },
      app_secret: "KEEP-SECRET",
    }
    const incoming = {
      provider: "whatsapp",
      phone_number_id: "999",
      // secrets omitted (redacted response → blank-field save)
    }
    const merged = preserveExistingSecrets(incoming, existing)!
    expect(merged.phone_number_id).toBe("999")
    expect(merged.access_token_encrypted).toEqual({ enc: "v1:keep" })
    expect(merged.app_secret).toBe("KEEP-SECRET")
  })

  it("lets a freshly-submitted secret win over the existing one", () => {
    const existing = { access_token: "OLD" }
    const incoming = { access_token: "NEW" }
    const merged = preserveExistingSecrets(incoming, existing)!
    expect(merged.access_token).toBe("NEW")
  })

  it("strips UI-only *_present hints before persisting", () => {
    const merged = preserveExistingSecrets(
      { access_token_present: true, phone_number_id: "1" },
      {}
    )!
    expect(merged.access_token_present).toBeUndefined()
    expect(merged.phone_number_id).toBe("1")
  })
})

describe("isSecretRevealAllowed (#32A MFA gate)", () => {
  function makeReq(opts: {
    revealQuery?: string
    authIdentityId?: string
    factors?: any[]
    throws?: boolean
  }): any {
    return {
      query: { reveal_secrets: opts.revealQuery },
      auth_context: opts.authIdentityId ? { auth_identity_id: opts.authIdentityId } : undefined,
      scope: {
        resolve: (key: string) => {
          if (key === Modules.AUTH) {
            return {
              listAuthMfa: async () => {
                if (opts.throws) throw new Error("boom")
                return opts.factors ?? []
              },
            }
          }
          throw new Error(`unexpected resolve(${key})`)
        },
      },
    }
  }

  it("false when reveal not requested", async () => {
    expect(
      await isSecretRevealAllowed(makeReq({ authIdentityId: "ai_1", factors: [{ status: "enabled" }] }))
    ).toBe(false)
  })

  it("false when requested but identity has no enabled MFA factor", async () => {
    expect(
      await isSecretRevealAllowed(makeReq({ revealQuery: "true", authIdentityId: "ai_1", factors: [] }))
    ).toBe(false)
  })

  it("true when reveal requested and identity has an enabled MFA factor", async () => {
    expect(
      await isSecretRevealAllowed(
        makeReq({ revealQuery: "true", authIdentityId: "ai_1", factors: [{ status: "enabled" }] })
      )
    ).toBe(true)
  })

  it("fails closed (false) on any error or missing auth context", async () => {
    expect(await isSecretRevealAllowed(makeReq({ revealQuery: "true" }))).toBe(false)
    expect(
      await isSecretRevealAllowed(makeReq({ revealQuery: "true", authIdentityId: "ai_1", throws: true }))
    ).toBe(false)
  })
})

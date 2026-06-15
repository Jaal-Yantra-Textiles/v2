/**
 * Unit test — encryptSocialPlatformCredentials (#32A token-shadow fix)
 *
 * The vflow-401 incident: a WhatsApp `SocialPlatform.api_config` carries a
 * plaintext `access_token` (just-rotated) AND a STALE `access_token_encrypted`
 * from a prior write. The resolver decrypts the ciphertext first, so it kept
 * using the old/expired token → Meta code 190 / 401 on every send.
 *
 * The fix: a plaintext credential present in `api_config` is always the source
 * of truth — `encryptBearer` must (re)encrypt it over any stale ciphertext and
 * strip the plaintext, instead of skipping whenever a `*_encrypted` key exists.
 *
 * Uses a trivial reversible fake encryptor (not the real EncryptionService,
 * which is constructed through Medusa's DI) — the helper only needs
 * encrypt/decrypt symmetry.
 *
 * Run:
 *   TEST_TYPE=unit npx jest --testPathPattern="social-platform-credentials-encryption"
 */
import { SOCIALS_MODULE } from "../../modules/socials"
import { ENCRYPTION_MODULE } from "../../modules/encryption"
import { encryptSocialPlatformCredentials } from "../social-platform-credentials-encryption"

type FakeCipher = { enc: string }

// Reversible, deterministic stand-in for AES-GCM. `decrypt` throws on a blob
// it didn't produce, mirroring a ciphertext written under a rotated/old key.
const fakeEncryption = {
  encrypt: (s: string): FakeCipher => ({ enc: `v1:${Buffer.from(s).toString("base64")}` }),
  decrypt: (d: any): string => {
    if (!d || typeof d.enc !== "string" || !d.enc.startsWith("v1:")) {
      throw new Error("undecryptable")
    }
    return Buffer.from(d.enc.slice(3), "base64").toString("utf8")
  },
}

describe("encryptSocialPlatformCredentials (#32A)", () => {
  // Build a fake container + socials service around a single platform row,
  // capturing whatever the helper writes back so we can assert on it.
  function makeHarness(apiConfig: Record<string, any>) {
    const row = { id: "socplat_1", name: "WhatsApp", api_config: apiConfig }
    let savedConfig: Record<string, any> | null = null
    const socials = {
      listSocialPlatforms: jest.fn(async () => [row]),
      updateSocialPlatforms: jest.fn(async (updates: any[]) => {
        savedConfig = updates[0].data.api_config
        return [{ ...row, api_config: savedConfig }]
      }),
    }
    const logger = { info: jest.fn(), error: jest.fn(), warn: jest.fn() }
    const container: any = {
      resolve: (key: string) => {
        if (key === SOCIALS_MODULE) return socials
        if (key === ENCRYPTION_MODULE) return fakeEncryption
        if (key === "logger") return logger
        throw new Error(`unexpected resolve(${key})`)
      },
    }
    return { container, socials, getSaved: () => savedConfig }
  }

  it("re-encrypts a fresh plaintext token over a STALE ciphertext (the incident)", async () => {
    // Stale ciphertext = the OLD expired token; plaintext = the rotated one.
    const stale = fakeEncryption.encrypt("OLD-EXPIRED-TOKEN")
    const { container, getSaved } = makeHarness({
      provider: "whatsapp",
      access_token: "NEW-ROTATED-TOKEN",
      access_token_encrypted: stale,
    })

    const result = await encryptSocialPlatformCredentials("socplat_1", container)

    expect(result.encrypted).toBe(true)
    const saved = getSaved()!
    // Plaintext stripped at rest…
    expect(saved.access_token).toBeNull()
    // …and the ciphertext now decrypts to the ROTATED token, not the stale one.
    expect(fakeEncryption.decrypt(saved.access_token_encrypted)).toBe("NEW-ROTATED-TOKEN")
  })

  it("encrypts a plaintext token when no ciphertext exists yet", async () => {
    const { container, getSaved } = makeHarness({
      provider: "whatsapp",
      access_token: "FIRST-TOKEN",
    })

    const result = await encryptSocialPlatformCredentials("socplat_1", container)

    expect(result.encrypted).toBe(true)
    const saved = getSaved()!
    expect(saved.access_token).toBeNull()
    expect(fakeEncryption.decrypt(saved.access_token_encrypted)).toBe("FIRST-TOKEN")
  })

  it("re-encrypts when the existing ciphertext is undecryptable (rotated key)", async () => {
    const { container, getSaved } = makeHarness({
      provider: "whatsapp",
      access_token: "NEW-TOKEN",
      access_token_encrypted: { enc: "garbage-not-ours" },
    })

    const result = await encryptSocialPlatformCredentials("socplat_1", container)

    expect(result.encrypted).toBe(true)
    const saved = getSaved()!
    expect(saved.access_token).toBeNull()
    expect(fakeEncryption.decrypt(saved.access_token_encrypted)).toBe("NEW-TOKEN")
  })

  it("strips a redundant plaintext that already matches the ciphertext (connect cleanup)", async () => {
    // The connect route writes both plaintext + matching ciphertext.
    const enc = fakeEncryption.encrypt("SAME-TOKEN")
    const { container, getSaved } = makeHarness({
      provider: "whatsapp",
      access_token: "SAME-TOKEN",
      access_token_encrypted: enc,
    })

    const result = await encryptSocialPlatformCredentials("socplat_1", container)

    expect(result.encrypted).toBe(true)
    const saved = getSaved()!
    expect(saved.access_token).toBeNull()
    expect(fakeEncryption.decrypt(saved.access_token_encrypted)).toBe("SAME-TOKEN")
  })

  it("is idempotent — a row with only ciphertext needs no write", async () => {
    const enc = fakeEncryption.encrypt("TOKEN")
    const { container, socials } = makeHarness({
      provider: "whatsapp",
      access_token: null,
      access_token_encrypted: enc,
    })

    const result = await encryptSocialPlatformCredentials("socplat_1", container)

    expect(result.encrypted).toBe(false)
    expect(socials.updateSocialPlatforms).not.toHaveBeenCalled()
  })
})

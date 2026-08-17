import {
  envCloudflareCreds,
  pickCloudflareCreds,
} from "../providers/cloudflare-credentials"

describe("pickCloudflareCreds", () => {
  const decrypt = (blob: string) => blob.replace(/^enc:/, "")

  it("prefers the encrypted token over plaintext", () => {
    const out = pickCloudflareCreds(
      { api_token: "plain-one", api_token_encrypted: "enc:real-one" },
      decrypt
    )
    expect(out?.token).toBe("real-one")
  })

  it("falls back to plaintext when decryption throws", () => {
    // A half-migrated row must keep working: the encryption module can be
    // absent or the blob unreadable, and refusing to fall back would take DNS
    // down for a partner whose credentials are otherwise fine.
    const boom = () => {
      throw new Error("bad key")
    }
    const out = pickCloudflareCreds(
      { api_token: "plain-one", api_token_encrypted: "enc:real-one" },
      boom
    )
    expect(out?.token).toBe("plain-one")
  })

  it("falls back to plaintext when no decrypt function is available", () => {
    const out = pickCloudflareCreds({
      api_token_encrypted: "enc:real-one",
      api_token: "plain-one",
    })
    expect(out?.token).toBe("plain-one")
  })

  it("accepts token/api_key as aliases so an operator can't fill in the wrong box", () => {
    expect(pickCloudflareCreds({ token: "t1" })?.token).toBe("t1")
    expect(pickCloudflareCreds({ api_key: "k1" })?.token).toBe("k1")
  })

  it("returns null when there is no token at all", () => {
    expect(pickCloudflareCreds({ zone_id: "z" })).toBeNull()
    expect(pickCloudflareCreds({})).toBeNull()
    expect(pickCloudflareCreds(null)).toBeNull()
    expect(pickCloudflareCreds({ api_token: "" })).toBeNull()
  })

  it("carries zone id, zone name and account id, trimming blanks to undefined", () => {
    const out = pickCloudflareCreds({
      api_token: "t",
      zone_id: " bff30e4a ",
      zone_name: "cicilabel.com",
      account_id: "   ",
    })
    expect(out).toMatchObject({
      token: "t",
      zoneId: "bff30e4a",
      zoneName: "cicilabel.com",
    })
    // A blank account id must not masquerade as a configured one.
    expect(out?.accountId).toBeUndefined()
  })

  it("keeps zone_name usable when zone_id is missing", () => {
    // The zone id is perishable — a domain removed and re-added to Cloudflare
    // keeps its name and gets a NEW id. Storing only the name has to remain a
    // valid configuration, or the recovery path can never run.
    const out = pickCloudflareCreds({ api_token: "t", zone_name: "cicilabel.com" })
    expect(out?.zoneId).toBeUndefined()
    expect(out?.zoneName).toBe("cicilabel.com")
  })
})

describe("envCloudflareCreds", () => {
  it("reads the legacy env trio and tags the source", () => {
    const out = envCloudflareCreds({
      CLOUDFLARE_API_TOKEN: "t",
      CLOUDFLARE_ZONE_ID: "z",
      CLOUDFLARE_ACCOUNT_ID: "a",
    } as any)
    expect(out).toEqual({
      token: "t",
      zoneId: "z",
      accountId: "a",
      source: "env",
    })
  })

  it("is null without a token, so callers skip rather than throw", () => {
    expect(envCloudflareCreds({ CLOUDFLARE_ZONE_ID: "z" } as any)).toBeNull()
  })
})

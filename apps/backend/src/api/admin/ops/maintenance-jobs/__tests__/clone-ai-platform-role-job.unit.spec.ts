import { cloneAiPlatformRoleJob } from "../clone-ai-platform-role-job"

const SOURCE = {
  id: "plat_glm",
  name: "Z.ai GLM — WhatsApp Partner Chat",
  category: "ai",
  status: "active",
  auth_type: "oauth2",
  base_url: null,
  api_config: {
    base_url: "https://api.z.ai/api/paas/v4",
    default_model: "glm-4.7-flash",
    api_key_encrypted: { iv: "x", data: "ciphertext", tag: "t" },
  },
  metadata: { role: "ai_whatsapp_partner_chat", is_default: true, provider_type: "custom" },
}

const containerWith = (platforms: any[]) => {
  const created: any[] = []
  const socials = {
    listSocialPlatforms: jest.fn(async (filter: any) =>
      filter.id
        ? platforms.filter((p) => p.id === filter.id)
        : platforms.filter((p) => p.status === "active" && p.metadata?.role === filter.metadata?.role)
    ),
    createSocialPlatforms: jest.fn(async (row: any) => {
      created.push(row)
      return { id: "plat_new", ...row }
    }),
  }
  return { container: { resolve: () => socials } as any, socials, created }
}

describe("clone-ai-platform-role", () => {
  const params = { source_platform_id: "plat_glm", role: "ai_partner_website_scan" }

  it("copies api_config byte-for-byte — the encrypted key is never decrypted — under the new role", async () => {
    const { container, created } = containerWith([SOURCE])
    const res = await cloneAiPlatformRoleJob.run(container, { dry_run: false, params })
    expect(res.applied).toBe(true)
    expect(created).toHaveLength(1)
    expect(created[0].api_config).toBe(SOURCE.api_config) // same object, not re-encoded
    expect(created[0].metadata).toMatchObject({
      role: "ai_partner_website_scan",
      is_default: true,
      provider_type: "custom",
      cloned_from: "plat_glm",
    })
    expect(created[0].category).toBe("ai")
  })

  it("previews without creating", async () => {
    const { container, created } = containerWith([SOURCE])
    const res = await cloneAiPlatformRoleJob.run(container, { dry_run: true, params })
    expect(res.applied).toBe(false)
    expect(res.summary).toMatch(/glm-4.7-flash/)
    expect(created).toHaveLength(0)
  })

  it("refuses when the role is already served — two defaults is a coin-toss", async () => {
    const already = { ...SOURCE, id: "plat_other", metadata: { role: "ai_partner_website_scan" } }
    const { container, created } = containerWith([SOURCE, already])
    const res = await cloneAiPlatformRoleJob.run(container, { dry_run: false, params })
    expect(res.applied).toBe(false)
    expect(res.summary).toMatch(/already served/)
    expect(created).toHaveLength(0)
  })

  it("refuses a source with no key, or a non-AI platform", async () => {
    const { container } = containerWith([{ ...SOURCE, api_config: { default_model: "x" } }])
    await expect(cloneAiPlatformRoleJob.run(container, { dry_run: true, params })).rejects.toThrow(/no API key/)
    const { container: c2 } = containerWith([{ ...SOURCE, category: "social" }])
    await expect(cloneAiPlatformRoleJob.run(c2, { dry_run: true, params })).rejects.toThrow(/No active AI platform/)
  })
})

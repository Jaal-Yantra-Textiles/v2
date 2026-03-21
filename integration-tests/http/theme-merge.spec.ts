import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(60 * 1000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Theme Editor - Merge Behavior", () => {
    let partnerHeaders: Record<string, string>
    let partnerId: string

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)

      const unique = Date.now()
      const partnerEmail = `partner-theme-${unique}@medusa-test.com`
      const domain = `theme-test-${unique}.test.com`

      // Register + login
      await api.post("/auth/partner/emailpass/register", {
        email: partnerEmail,
        password: TEST_PARTNER_PASSWORD,
      })

      const login1 = await api.post("/auth/partner/emailpass", {
        email: partnerEmail,
        password: TEST_PARTNER_PASSWORD,
      })
      partnerHeaders = { Authorization: `Bearer ${login1.data.token}` }

      // Create partner
      const createRes = await api.post(
        "/partners",
        {
          name: `Theme Test ${unique}`,
          handle: `theme-test-${unique}`,
          admin: {
            email: partnerEmail,
            first_name: "Theme",
            last_name: "Tester",
          },
        },
        { headers: partnerHeaders }
      )
      partnerId = createRes.data.partner.id

      // Fresh token
      const login2 = await api.post("/auth/partner/emailpass", {
        email: partnerEmail,
        password: TEST_PARTNER_PASSWORD,
      })
      partnerHeaders = { Authorization: `Bearer ${login2.data.token}` }

      // Create a website and link it to the partner via storefront_domain
      const websiteService = container.resolve("websites") as any
      const website = await websiteService.createWebsites({
        domain,
        name: `Theme Test Site ${unique}`,
      })

      const partnerService = container.resolve("partner") as any
      await partnerService.updatePartners({
        selector: { id: partnerId },
        data: {
          storefront_domain: domain,
          website_id: website.id,
        },
      })
    })

    it("should save theme with multiple sections", async () => {
      const fullTheme = {
        colors: { primary: "#7c3aed", background: "#ffffff", text: "#111827" },
        hero: { title: "Welcome", subtitle: "To our store", layout: "center" },
        animations: { enabled: true, hero_entrance: "fade-up", global_duration: "normal" },
        typography: { font_family: "Inter", heading_font_family: "Playfair Display" },
      }

      const putRes = await api.put(
        "/partners/storefront/website/theme",
        fullTheme,
        { headers: partnerHeaders }
      )
      expect(putRes.status).toBe(200)
      expect(putRes.data.theme.colors.primary).toBe("#7c3aed")
      expect(putRes.data.theme.hero.title).toBe("Welcome")
      expect(putRes.data.theme.animations.enabled).toBe(true)
    })

    it("should merge: updating animations preserves hero and colors", async () => {
      // First save full theme
      await api.put(
        "/partners/storefront/website/theme",
        {
          colors: { primary: "#ff0000", background: "#ffffff" },
          hero: { title: "My Store", layout: "left" },
          typography: { font_family: "Inter" },
        },
        { headers: partnerHeaders }
      )

      // Now update only animations
      const putRes = await api.put(
        "/partners/storefront/website/theme",
        {
          animations: { enabled: true, hero_entrance: "fade-down", global_duration: "slow" },
        },
        { headers: partnerHeaders }
      )

      expect(putRes.status).toBe(200)

      // Verify merged result
      const getRes = await api.get(
        "/partners/storefront/website/theme",
        { headers: partnerHeaders }
      )

      expect(getRes.status).toBe(200)
      const theme = getRes.data.theme

      // Animations should be updated
      expect(theme.animations.enabled).toBe(true)
      expect(theme.animations.hero_entrance).toBe("fade-down")
      expect(theme.animations.global_duration).toBe("slow")

      // Hero and colors should be preserved
      expect(theme.hero.title).toBe("My Store")
      expect(theme.hero.layout).toBe("left")
      expect(theme.colors.primary).toBe("#ff0000")
      expect(theme.colors.background).toBe("#ffffff")
      expect(theme.typography.font_family).toBe("Inter")
    })

    it("should merge: updating hero.bg_animation preserves hero.title", async () => {
      // Save hero with title
      await api.put(
        "/partners/storefront/website/theme",
        {
          hero: { title: "Keep This", subtitle: "And This", layout: "center" },
        },
        { headers: partnerHeaders }
      )

      // Update only bg_animation within hero
      await api.put(
        "/partners/storefront/website/theme",
        {
          hero: { bg_animation: "ken-burns" },
        },
        { headers: partnerHeaders }
      )

      const getRes = await api.get(
        "/partners/storefront/website/theme",
        { headers: partnerHeaders }
      )

      const hero = getRes.data.theme.hero
      expect(hero.bg_animation).toBe("ken-burns")
      expect(hero.title).toBe("Keep This")
      expect(hero.subtitle).toBe("And This")
      expect(hero.layout).toBe("center")
    })

    it("should return empty theme when nothing saved", async () => {
      const getRes = await api.get(
        "/partners/storefront/website/theme",
        { headers: partnerHeaders }
      )

      expect(getRes.status).toBe(200)
      expect(getRes.data.theme).toBeDefined()
    })
  })
})

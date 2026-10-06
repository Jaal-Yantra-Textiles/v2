/**
 * #2350 — one WhatsApp number belongs to one partner.
 *
 * 2026-10-05: Embroprint was connected to Lucknavi boutique's verified number.
 * Two Embroprint job alerts went to Lucknavi's owner, the real
 * Embroprint got neither, and a reply from that phone would have resolved to
 * whichever partner the inbound match found first. These pin both halves:
 * the write is refused, and an already-shared number acts for nobody.
 */
import { MedusaError } from "@medusajs/framework/utils"

import { assertWhatsappNumberFree, partnersHoldingNumber } from "../whatsapp-number-owner"
import { resolvePartnerByPhone } from "../../whatsapp/whatsapp-message-handler"

const LUCKNAVI = { id: "p_lucknavi", name: "Lucknavi boutique", whatsapp_number: "919000000001" }
const EMBROPRINT = { id: "p_embroprint", name: "Embroprint", whatsapp_number: "919000000002" }

describe("partnersHoldingNumber", () => {
  it("finds the partner holding the number, with or without the country code", () => {
    expect(partnersHoldingNumber([LUCKNAVI, EMBROPRINT], "919000000001")).toEqual([LUCKNAVI])
    expect(partnersHoldingNumber([LUCKNAVI, EMBROPRINT], "+91 90000 00001")).toEqual([LUCKNAVI])
    expect(partnersHoldingNumber([LUCKNAVI, EMBROPRINT], "9000000001")).toEqual([LUCKNAVI])
  })

  it("does not count the partner being edited as a conflict with itself", () => {
    expect(partnersHoldingNumber([LUCKNAVI], "919000000001", "p_lucknavi")).toEqual([])
  })

  it("ignores fragments too short to compare safely", () => {
    expect(partnersHoldingNumber([LUCKNAVI], "7833")).toEqual([])
  })

  it("returns nothing for a free number", () => {
    expect(partnersHoldingNumber([LUCKNAVI, EMBROPRINT], "919000000000")).toEqual([])
  })
})

describe("assertWhatsappNumberFree", () => {
  const service = (partners: any[]) => ({
    listAndCountPartners: jest.fn().mockResolvedValue([partners, partners.length]),
  })

  it("refuses an admin connecting a number another partner holds, naming that partner", async () => {
    const err = await assertWhatsappNumberFree(
      service([LUCKNAVI, EMBROPRINT]),
      "919000000001",
      "p_embroprint",
      "admin"
    ).catch((e) => e)
    expect(err).toBeInstanceOf(MedusaError)
    expect(err.type).toBe(MedusaError.Types.CONFLICT)
    expect(err.message).toContain("Lucknavi boutique")
    expect(err.message).toContain("p_lucknavi")
  })

  it("tells a PARTNER only that the number is taken — never whose it is", async () => {
    const err = await assertWhatsappNumberFree(
      service([LUCKNAVI, EMBROPRINT]),
      "919000000001",
      "p_embroprint",
      "partner"
    ).catch((e) => e)
    expect(err.type).toBe(MedusaError.Types.CONFLICT)
    expect(err.message).not.toContain("Lucknavi")
    expect(err.message).not.toContain("p_lucknavi")
  })

  it("allows a free number and the partner's own number", async () => {
    await expect(
      assertWhatsappNumberFree(service([LUCKNAVI, EMBROPRINT]), "919000000002", "p_embroprint")
    ).resolves.toBeUndefined()
    await expect(
      assertWhatsappNumberFree(service([LUCKNAVI, EMBROPRINT]), "919000000000", "p_embroprint")
    ).resolves.toBeUndefined()
  })
})

describe("resolvePartnerByPhone with a shared number", () => {
  const scopeWith = (partners: any[]) => {
    const updatePartners = jest.fn()
    const service = {
      listAndCountPartners: jest.fn().mockResolvedValue([partners, partners.length]),
      updatePartners,
      updatePartnerAdmins: jest.fn(),
    }
    return { scope: { resolve: () => service }, updatePartners }
  }
  const verified = (p: any, admins: any[] = []) => ({ ...p, whatsapp_verified: true, admins })

  it("resolves the one partner that holds a number", async () => {
    const { scope } = scopeWith([verified(LUCKNAVI), verified(EMBROPRINT)])
    const resolved = await resolvePartnerByPhone(scope, "919000000002")
    expect(resolved?.partnerId).toBe("p_embroprint")
  })

  it("acts for NEITHER partner when two hold the same verified number", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined)
    const { scope } = scopeWith([
      verified(LUCKNAVI),
      verified({ ...EMBROPRINT, whatsapp_number: "919000000001" }),
    ])
    expect(await resolvePartnerByPhone(scope, "919000000001")).toBeNull()
    errorSpy.mockRestore()
  })

  it("acts for neither when admins of two different partners share the phone", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined)
    const admin = (id: string) => ({ id, phone: "9000000001", is_active: true, first_name: "A", metadata: {} })
    const { scope } = scopeWith([
      { ...LUCKNAVI, whatsapp_number: null, whatsapp_verified: false, admins: [admin("a1")] },
      { ...EMBROPRINT, whatsapp_number: null, whatsapp_verified: false, admins: [admin("a2")] },
    ])
    expect(await resolvePartnerByPhone(scope, "919000000001")).toBeNull()
    errorSpy.mockRestore()
  })

  it("does not auto-copy an admin phone onto a partner when another partner holds that number", async () => {
    const admin = { id: "a2", phone: "9000000001", is_active: true, first_name: "S", metadata: {} }
    const { scope, updatePartners } = scopeWith([
      // Holds the number, but unverified — so priority 1 does not claim it.
      { ...LUCKNAVI, whatsapp_verified: false, admins: [] },
      { ...EMBROPRINT, whatsapp_number: null, whatsapp_verified: false, admins: [admin] },
    ])
    const resolved = await resolvePartnerByPhone(scope, "919000000001")
    expect(resolved?.partnerId).toBe("p_embroprint")
    expect(updatePartners).not.toHaveBeenCalled()
  })
})

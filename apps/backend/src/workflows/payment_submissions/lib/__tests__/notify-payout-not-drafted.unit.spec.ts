import { notifyPayoutNotDrafted } from "../notify-payout-not-drafted"

/*
 * #2433 — the telling.
 *
 * A priced, completed run whose payout draft was refused produced one
 * `logger.info` and no other trace. Ksaman's payout went missing that way.
 */

const notificationService = { createNotifications: jest.fn() }
const container = {
  resolve: (key: string) => {
    if (key === "notification") return notificationService
    throw new Error(`unexpected module ${key}`)
  },
}

const NOTICE = {
  runId: "prod_run_ksaman",
  partnerId: "partner_ksaman",
  designId: "des_robes",
  amount: 4000,
  refusal: "Designs not assigned to this partner: des_robes",
  source: "production_run.completed",
}

beforeEach(() => {
  notificationService.createNotifications.mockReset()
  notificationService.createNotifications.mockResolvedValue({ id: "noti_1" })
})

describe("notifyPayoutNotDrafted", () => {
  it("raises an admin-feed notice naming the run, partner, design, amount and refusal", async () => {
    const ok = await notifyPayoutNotDrafted(container, NOTICE)

    expect(ok).toBe(true)
    // Asserted on mock.calls AFTER the await — an expect() inside a mock the
    // code wraps in try/catch is swallowed.
    const [arg] = notificationService.createNotifications.mock.calls[0]
    expect(arg.channel).toBe("feed")
    expect(arg.template).toBe("admin-ui")
    for (const s of [
      "prod_run_ksaman",
      "partner_ksaman",
      "des_robes",
      "4000",
      "Designs not assigned to this partner",
    ]) {
      expect(arg.data.description).toContain(s)
    }
    expect(arg.data.metadata).toMatchObject({
      production_run_id: "prod_run_ksaman",
      partner_id: "partner_ksaman",
      design_id: "des_robes",
      amount: 4000,
      reason: "payout_draft_refused",
      severity: "warning",
    })
  })

  it("names a way out, so the reader is not left to invent one", async () => {
    await notifyPayoutNotDrafted(container, NOTICE)
    const [arg] = notificationService.createNotifications.mock.calls[0]
    expect(arg.data.description).toContain("raise the payout by hand")
  })

  it("🔴 never throws when the notification module is down, and says so", async () => {
    const warn = jest.fn()
    const broken = {
      resolve: () => {
        throw new Error("notification module down")
      },
    }

    await expect(
      notifyPayoutNotDrafted(broken, NOTICE, { warn })
    ).resolves.toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("prod_run_ksaman"))
  })

  it("never throws when createNotifications itself rejects", async () => {
    notificationService.createNotifications.mockRejectedValueOnce(
      new Error("feed unavailable")
    )
    const warn = jest.fn()

    await expect(
      notifyPayoutNotDrafted(container, NOTICE, { warn })
    ).resolves.toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("feed unavailable"))
  })

  it("survives having no logger at all", async () => {
    const broken = {
      resolve: () => {
        throw new Error("down")
      },
    }
    await expect(notifyPayoutNotDrafted(broken, NOTICE)).resolves.toBe(false)
  })
})

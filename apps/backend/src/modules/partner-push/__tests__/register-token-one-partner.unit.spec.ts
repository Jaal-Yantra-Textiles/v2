import PartnerPushService from "../service"

type Row = { id: string; partner_id: string; token: string; platform: string; app_version: string | null }

/**
 * A device token belongs to whoever is signed in on that phone now. The
 * service's own generated CRUD methods are replaced with an in-memory table,
 * so this exercises `registerToken`'s logic and nothing else.
 */
const harness = (rows: Row[]) => {
  let seq = rows.length
  const table = [...rows]
  const fake = {
    listPartnerPushTokens: async (filter: Partial<Row>) =>
      table.filter((r) =>
        Object.entries(filter).every(([k, v]) => (r as any)[k] === v)
      ),
    deletePartnerPushTokens: async (ids: string[]) => {
      for (const id of ids) {
        const i = table.findIndex((r) => r.id === id)
        if (i >= 0) table.splice(i, 1)
      }
    },
    updatePartnerPushTokens: async (patch: Partial<Row> & { id: string }) => {
      const row = table.find((r) => r.id === patch.id)!
      Object.assign(row, patch)
      return row
    },
    createPartnerPushTokens: async (data: Omit<Row, "id">) => {
      const row = { id: `pptok_${++seq}`, ...data }
      table.push(row)
      return row
    },
  }
  const register = (input: Parameters<PartnerPushService["registerToken"]>[0]) =>
    PartnerPushService.prototype.registerToken.call(fake, input)
  return { table, register }
}

describe("PartnerPushService.registerToken — one partner per device", () => {
  it("moves a device to the newly signed-in partner and drops the old partner's row", async () => {
    const { table, register } = harness([
      { id: "pptok_1", partner_id: "sharlho", token: "fcm-A", platform: "android", app_version: "1.0" },
    ])

    await register({ partner_id: "other", token: "fcm-A", platform: "android", app_version: "1.1" })

    expect(table.filter((r) => r.token === "fcm-A").map((r) => r.partner_id)).toEqual(["other"])
  })

  it("leaves the old partner's OTHER devices alone", async () => {
    const { table, register } = harness([
      { id: "pptok_1", partner_id: "sharlho", token: "fcm-A", platform: "android", app_version: null },
      { id: "pptok_2", partner_id: "sharlho", token: "fcm-B", platform: "android", app_version: null },
    ])

    await register({ partner_id: "other", token: "fcm-A", platform: "android" })

    expect(table.find((r) => r.token === "fcm-B")?.partner_id).toBe("sharlho")
  })

  it("re-registering the same partner updates in place, no duplicate", async () => {
    const { table, register } = harness([
      { id: "pptok_1", partner_id: "sharlho", token: "fcm-A", platform: "android", app_version: "1.0" },
    ])

    await register({ partner_id: "sharlho", token: "fcm-A", platform: "android", app_version: "1.2" })

    expect(table).toHaveLength(1)
    expect(table[0]).toMatchObject({ id: "pptok_1", app_version: "1.2" })
  })
})

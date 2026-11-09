import { mapPartnerChannels } from "../partner-sales-channels-job"

describe("mapPartnerChannels", () => {
  it("maps each store's default channel to its partner", () => {
    const { byChannel, ambiguous } = mapPartnerChannels([
      { id: "p1", stores: [{ default_sales_channel_id: "sc_1" }] },
      { id: "p2", stores: [{ default_sales_channel_id: "sc_2" }, null] },
      { id: "p3", stores: [] },
    ])

    expect([...byChannel.entries()]).toEqual([
      ["sc_1", "p1"],
      ["sc_2", "p2"],
    ])
    expect(ambiguous.size).toBe(0)
  })

  it("never marks a channel two partners' stores share", () => {
    const { byChannel, ambiguous } = mapPartnerChannels([
      { id: "p1", stores: [{ default_sales_channel_id: "sc_shared" }] },
      { id: "p2", stores: [{ default_sales_channel_id: "sc_shared" }] },
    ])

    expect(byChannel.has("sc_shared")).toBe(false)
    expect([...ambiguous]).toEqual(["sc_shared"])
  })

  it("skips stores with no channel", () => {
    const { byChannel } = mapPartnerChannels([
      { id: "p1", stores: [{ default_sales_channel_id: null }] },
    ])

    expect(byChannel.size).toBe(0)
  })
})

import { decideCrossList } from "../lib/artisan-cross-list-decision"

const CORE = "sc_core"

describe("decideCrossList (#861 artisan cross-list)", () => {
  it("cross-lists a published, artisan-owned product not yet on the core channel", () => {
    expect(
      decideCrossList({
        hasOwnerLink: true,
        status: "published",
        coreChannelId: CORE,
        currentChannelIds: ["sc_partner"],
      })
    ).toEqual({ action: "cross_list", channelId: CORE })
  })

  it("skips a product with no partner-product link (not artisan-owned)", () => {
    expect(
      decideCrossList({
        hasOwnerLink: false,
        status: "published",
        coreChannelId: CORE,
        currentChannelIds: [],
      })
    ).toEqual({ action: "skip", reason: "not_artisan_owned" })
  })

  it.each(["proposed", "draft", "rejected", null, undefined])(
    "skips when status is %s (only 'published' cross-lists)",
    (status) => {
      expect(
        decideCrossList({
          hasOwnerLink: true,
          status: status as any,
          coreChannelId: CORE,
          currentChannelIds: [],
        })
      ).toEqual({ action: "skip", reason: "not_published" })
    }
  )

  it("skips when the core channel could not be resolved", () => {
    expect(
      decideCrossList({
        hasOwnerLink: true,
        status: "published",
        coreChannelId: null,
        currentChannelIds: [],
      })
    ).toEqual({ action: "skip", reason: "no_core_channel" })
  })

  it("is idempotent — skips when the product is already on the core channel", () => {
    expect(
      decideCrossList({
        hasOwnerLink: true,
        status: "published",
        coreChannelId: CORE,
        currentChannelIds: ["sc_partner", CORE],
      })
    ).toEqual({ action: "skip", reason: "already_listed" })
  })
})

import {
  isUnrecoveredMetaMediaUrl,
  resolveMetaMediaId,
} from "../recover-whatsapp-media-job"

/**
 * The two decisions that pick which photographs get re-fetched from Meta, and
 * which id is used. Both operate on a URL shape Meta owns and can change, so
 * they are the parts worth pinning.
 */

describe("isUnrecoveredMetaMediaUrl", () => {
  it("recognises the lookaside URL that has been sitting in every stale row", () => {
    expect(
      isUnrecoveredMetaMediaUrl(
        "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1451191166854891&source=getMedia&ext=1787661397&hash=ATwz"
      )
    ).toBe(true)
  })

  it("leaves our own stored URLs alone", () => {
    expect(
      isUnrecoveredMetaMediaUrl("https://media.jaalyantra.com/whatsapp/abc.jpg")
    ).toBe(false)
  })

  it("matches on the HOST, not on the substring", () => {
    // 🔑 A naive `includes("fbsbx")` would re-fetch this and OVERWRITE a
    // perfectly good stored file with whatever Meta returned for the id.
    expect(
      isUnrecoveredMetaMediaUrl(
        "https://media.jaalyantra.com/uploads/from-fbsbx.com-export.jpg"
      )
    ).toBe(false)
  })

  it("treats absent and unparseable values as nothing to do", () => {
    expect(isUnrecoveredMetaMediaUrl(null)).toBe(false)
    expect(isUnrecoveredMetaMediaUrl("")).toBe(false)
    expect(isUnrecoveredMetaMediaUrl("not a url")).toBe(false)
  })
})

describe("resolveMetaMediaId", () => {
  it("prefers the stored column over the URL", () => {
    // The column is the recorded fact; the URL shape is Meta's to change.
    expect(
      resolveMetaMediaId({
        media_id: "999",
        media_url: "https://lookaside.fbsbx.com/x/?mid=111",
      })
    ).toBe("999")
  })

  it("falls back to mid= for rows written before the column existed", () => {
    expect(
      resolveMetaMediaId({
        media_id: null,
        media_url:
          "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1451191166854891&source=getMedia",
      })
    ).toBe("1451191166854891")
  })

  it("returns null rather than a guess when there is neither", () => {
    // 🔑 Null is what makes the job REPORT the row instead of inventing an id
    // and asking Meta about a photograph that was never ours.
    expect(resolveMetaMediaId({ media_id: null, media_url: null })).toBeNull()
    expect(
      resolveMetaMediaId({
        media_id: "   ",
        media_url: "https://lookaside.fbsbx.com/x/?source=getMedia",
      })
    ).toBeNull()
  })
})

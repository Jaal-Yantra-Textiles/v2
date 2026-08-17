import {
  MAX_CONVERSATION_ATTACHMENTS,
  mergeAttachments,
  renderAttachments,
} from "../chat/attachments"
import {
  assistantFolderName,
  assistantFolderPath,
  assistantFolderSlug,
} from "../attachments/folder-naming"

describe("partner assistant — folder naming", () => {
  it("derives the slug from the partner id, not the name", () => {
    // Two partners can share a display name, and folder.slug is UNIQUE — an
    // name-derived slug would make the second partner's first upload fail.
    expect(assistantFolderSlug("part_123")).toBe("partner-assistant-part_123")
    expect(assistantFolderSlug("part_123")).toBe(assistantFolderSlug("part_123"))
    expect(assistantFolderSlug("part_456")).not.toBe(
      assistantFolderSlug("part_123")
    )
  })

  it("is stable when the partner renames itself", () => {
    const before = assistantFolderSlug("part_123")
    const after = assistantFolderSlug("part_123")
    expect(before).toBe(after)
    expect(assistantFolderName("Old Name")).not.toBe(
      assistantFolderName("New Name")
    )
  })

  it("falls back to a generic name when the partner has none", () => {
    expect(assistantFolderName("Pashmina Co")).toBe(
      "Assistant uploads — Pashmina Co"
    )
    expect(assistantFolderName("")).toBe("Assistant uploads")
    expect(assistantFolderName(null)).toBe("Assistant uploads")
    expect(assistantFolderName(undefined)).toBe("Assistant uploads")
  })

  it("puts the folder at the root, matching createFolderStep's convention", () => {
    expect(assistantFolderPath("part_123")).toBe("/partner-assistant-part_123")
  })
})

describe("partner assistant — mergeAttachments", () => {
  const a = { url: "https://cdn/1.jpg", name: "one.jpg" }
  const b = { url: "https://cdn/2.jpg", name: "two.jpg" }

  it("de-duplicates by url when both sources carry the same photo", () => {
    // The normal case: the upload completes before the message is sent, so the
    // folder and the request body describe the SAME rows. Rendering both would
    // show the model every photo twice.
    expect(mergeAttachments([a, b], [b])).toEqual([a, b])
  })

  it("survives either source being empty", () => {
    expect(mergeAttachments([a], [])).toEqual([a])
    expect(mergeAttachments([], [a])).toEqual([a])
    expect(mergeAttachments([], [])).toEqual([])
  })

  it("keeps conversation order, oldest first", () => {
    expect(mergeAttachments([a, b], []).map((x) => x.url)).toEqual([
      a.url,
      b.url,
    ])
  })

  it("drops entries with no usable url", () => {
    // A media row with no file_path would otherwise be handed to the model as
    // `url=undefined`, which it would then try to read.
    expect(
      mergeAttachments([{ url: "" } as any, { url: "   " } as any, a], [])
    ).toEqual([a])
  })

  it("caps the list so a long catalogue session cannot dominate the turn", () => {
    const many = Array.from({ length: MAX_CONVERSATION_ATTACHMENTS + 10 }, (_, i) => ({
      url: `https://cdn/${i}.jpg`,
    }))
    const merged = mergeAttachments(many, [])
    expect(merged).toHaveLength(MAX_CONVERSATION_ATTACHMENTS)
    // Keeps the MOST RECENT ones — the older photos are the ones a partner has
    // usually already turned into products.
    expect(merged[merged.length - 1].url).toBe(many[many.length - 1].url)
  })
})

describe("partner assistant — renderAttachments", () => {
  it("states the photos exist, that they cannot be seen, and how to look", () => {
    const out = renderAttachments([
      { url: "https://cdn/1.jpg", name: "shawl.jpg", mime_type: "image/jpeg" },
    ])
    expect(out).toContain("CANNOT see them")
    expect(out).toContain("describe_image")
    expect(out).toContain("url=https://cdn/1.jpg")
    expect(out).toContain("name=shawl.jpg")
    expect(out).toContain("type=image/jpeg")
  })

  it("numbers photos from 1 in conversation order", () => {
    const out = renderAttachments([
      { url: "https://cdn/1.jpg" },
      { url: "https://cdn/2.jpg" },
    ])
    expect(out).toContain("[photo 1] name=untitled type=unknown url=https://cdn/1.jpg")
    expect(out).toContain("[photo 2] name=untitled type=unknown url=https://cdn/2.jpg")
    expect(out).toContain("2 photo(s) have been shared")
  })
})

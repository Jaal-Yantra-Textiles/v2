import { toResendAttachments } from "../service"

describe("toResendAttachments (#2532)", () => {
  it("passes base64 content through and renames content_type", () => {
    expect(
      toResendAttachments([
        { filename: "JYT-2026-27-0001.pdf", content: "JVBERi0=", content_type: "application/pdf" },
      ])
    ).toEqual([
      { filename: "JYT-2026-27-0001.pdf", content: "JVBERi0=", contentType: "application/pdf" },
    ])
  })

  it("drops entries with no name or content, and handles none", () => {
    expect(toResendAttachments([{ filename: "a.pdf", content: "" }, { content: "x" }])).toEqual([])
    expect(toResendAttachments(undefined)).toEqual([])
  })
})

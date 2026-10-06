import { assertBlogSendable } from "../fetch-blog-data"

describe("assertBlogSendable", () => {
  it("sends a published blog or newsletter", () => {
    expect(() => assertBlogSendable({ page_type: "Blog", status: "Published" })).not.toThrow()
    expect(() => assertBlogSendable({ page_type: "Newsletter", status: "Published" })).not.toThrow()
  })

  it("refuses a draft for a real send", () => {
    expect(() => assertBlogSendable({ page_type: "Blog", status: "Draft" })).toThrow(
      "Only published blogs can be sent to subscribers"
    )
  })

  it("lets a TEST send go out from a draft", () => {
    expect(() =>
      assertBlogSendable({ page_type: "Blog", status: "Draft" }, { allowUnpublished: true })
    ).not.toThrow()
  })

  it("never sends a page that is not a blog, even as a test", () => {
    expect(() =>
      assertBlogSendable({ page_type: "Home", status: "Published" }, { allowUnpublished: true })
    ).toThrow("Only blog or newsletter pages")
  })
})

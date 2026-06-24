import { buildPreviewPath } from "../preview-url"

describe("buildPreviewPath", () => {
  it("serves Blog pages under /blog/<slug>", () => {
    expect(buildPreviewPath("my-post", "Blog")).toBe("/blog/my-post")
  })

  it("serves Newsletter pages under /blog/<slug>", () => {
    expect(buildPreviewPath("june-update", "Newsletter")).toBe("/blog/june-update")
  })

  it("uses a custom absolute slug verbatim (no prefix), even for Blog", () => {
    expect(buildPreviewPath("/custom", "Blog")).toBe("/custom")
    expect(buildPreviewPath("/custom", "About")).toBe("/custom")
  })

  it("maps the 'home' slug to the root path", () => {
    expect(buildPreviewPath("home")).toBe("/")
    expect(buildPreviewPath("home", "About")).toBe("/")
  })

  it("maps the Home page_type to the root path regardless of slug", () => {
    expect(buildPreviewPath("landing", "Home")).toBe("/")
  })

  it("keeps non-blog page types at root level", () => {
    expect(buildPreviewPath("about-us", "About")).toBe("/about-us")
    expect(buildPreviewPath("contact", "Contact")).toBe("/contact")
    expect(buildPreviewPath("widget", "Product")).toBe("/widget")
    expect(buildPreviewPath("anything")).toBe("/anything")
  })
})

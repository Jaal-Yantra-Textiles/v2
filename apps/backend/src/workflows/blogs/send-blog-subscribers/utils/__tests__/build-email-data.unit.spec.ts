import { buildEmailData, convertContentToHtml } from "../build-email-data"

// Locks in the blog-email variant parity (#946): the test-send and the
// production batch send both render the redesigned `blog-subscriber` template
// from this single payload, so the fields the template relies on (UTM-tagged
// links, two-doors CTAs, personal note, unsubscribe-by-email) must be present.

const SUBSCRIBER = {
  id: "sub_123",
  email: "jane@example.com",
  first_name: "Jane",
  last_name: "Doe",
}

const BLOG = {
  title: "Handloom stories",
  slug: "handloom-stories",
  url: "/blogs/handloom-stories",
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-02T00:00:00Z",
  tags: ["handloom"],
}

const CONFIG = { subject: "New post: Handloom stories", customMessage: "Thought you'd love this." }

describe("buildEmailData (#946 blog-email parity)", () => {
  const prevFrontend = process.env.FRONTEND_URL
  beforeAll(() => {
    process.env.FRONTEND_URL = "https://jaalyantra.com"
  })
  afterAll(() => {
    process.env.FRONTEND_URL = prevFrontend
  })

  it("UTM-tags every outbound link with the post slug as campaign", () => {
    const data = buildEmailData(SUBSCRIBER, BLOG, "<p>hi</p>", CONFIG)
    const utm = "utm_source=newsletter&utm_medium=email&utm_campaign=handloom-stories"
    expect(data.blog_url).toContain(utm)
    expect(data.website_url).toContain(utm)
    expect(data.shop_url).toContain(utm)
    expect(data.create_url).toContain(utm)
    // blog_url has no pre-existing query → separator must be "?"
    expect(data.blog_url).toBe(`https://jaalyantra.com/blogs/handloom-stories?${utm}`)
  })

  it("falls back to blog_broadcast campaign when the post has no slug", () => {
    const data = buildEmailData(SUBSCRIBER, { ...BLOG, slug: undefined }, "<p>hi</p>", CONFIG)
    expect(data.blog_url).toContain("utm_campaign=blog_broadcast")
  })

  it("carries both the two-doors CTAs", () => {
    const data = buildEmailData(SUBSCRIBER, BLOG, "<p>hi</p>", CONFIG)
    expect(data.shop_url).toContain("https://cicilabel.com")
    expect(data.create_url).toContain("https://jaalyantra.com")
  })

  it("unsubscribe_url suppresses by id AND email so it works when the id can't resolve", () => {
    const data = buildEmailData(SUBSCRIBER, BLOG, "<p>hi</p>", CONFIG)
    expect(data.unsubscribe_url).toContain("id=sub_123")
    expect(data.unsubscribe_url).toContain("email=jane%40example.com")
  })

  it("passes subject + custom_message through", () => {
    const data = buildEmailData(SUBSCRIBER, BLOG, "<p>hi</p>", CONFIG)
    expect(data.subject).toBe(CONFIG.subject)
    expect(data.custom_message).toBe(CONFIG.customMessage)
  })

  it("defaults is_test to false and flags it true for test-sends", () => {
    expect(buildEmailData(SUBSCRIBER, BLOG, "<p>hi</p>", CONFIG).is_test).toBe(false)
    expect(buildEmailData(SUBSCRIBER, BLOG, "<p>hi</p>", CONFIG, { isTest: true }).is_test).toBe(true)
  })

  it("populates the nested person + blog objects the template also reads", () => {
    const data = buildEmailData(SUBSCRIBER, BLOG, "<p>body</p>", CONFIG)
    expect(data.person).toMatchObject({ id: "sub_123", email: "jane@example.com", first_name: "Jane" })
    expect(data.blog).toMatchObject({ title: "Handloom stories", content: "<p>body</p>" })
  })
})

describe("convertContentToHtml", () => {
  it("passes plain-text content through unchanged", () => {
    expect(convertContentToHtml("just a sentence")).toBe("just a sentence")
  })

  it("coerces null/undefined to an empty string", () => {
    expect(convertContentToHtml(null)).toBe("")
    expect(convertContentToHtml(undefined)).toBe("")
  })
})

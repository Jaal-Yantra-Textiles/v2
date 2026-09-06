import {
  emptyPublishedPages,
  expectsPublishedPage,
  failedSends,
  isLive,
  newslettersAwaitingSend,
  publishedPages,
  type PageLike,
} from "../absence"

const page = (over: Partial<PageLike> = {}): PageLike => ({
  id: over.id ?? "page_1",
  status: "Published",
  page_type: "Custom",
  content: "some body",
  sent_to_subscribers: false,
  block_count: 1,
  ...over,
})

describe("isLive", () => {
  it("counts the statuses that serve traffic", () => {
    expect(isLive("Active")).toBe(true)
    // Maintenance still resolves — it serves a page, just not the real one.
    expect(isLive("Maintenance")).toBe(true)
  })

  it("excludes the ones still being built", () => {
    expect(isLive("Development")).toBe(false)
    expect(isLive("Inactive")).toBe(false)
    expect(isLive(null)).toBe(false)
  })
})

describe("expectsPublishedPage", () => {
  it("fires on a live website serving nothing", () => {
    expect(expectsPublishedPage("Active", [page({ status: "Draft" })])).toBe(true)
  })

  it("stays quiet on a website still being built", () => {
    /*
     * 🔴 The case that decides whether this rule is worth having. Every website
     * is `Development` with no published page for its whole early life;
     * asserting there would put a red edge on all of them.
     */
    expect(expectsPublishedPage("Development", [])).toBe(false)
    expect(expectsPublishedPage("Inactive", [])).toBe(false)
  })

  it("stays quiet once one page is live", () => {
    expect(expectsPublishedPage("Active", [page()])).toBe(false)
  })
})

describe("newslettersAwaitingSend — the content spine's approved_product_id", () => {
  it("finds a published newsletter nobody received", () => {
    const found = newslettersAwaitingSend([
      page({ id: "n1", page_type: "Newsletter", sent_to_subscribers: false }),
    ])
    expect(found.map((p) => p.id)).toEqual(["n1"])
  })

  it("ignores one that was sent", () => {
    expect(
      newslettersAwaitingSend([
        page({ id: "n1", page_type: "Newsletter", sent_to_subscribers: true }),
      ])
    ).toHaveLength(0)
  })

  it("ignores a DRAFT newsletter", () => {
    /*
     * 🔴 Unfinished work owes nothing. Every newsletter is a draft before it is
     * anything else, and the local database's newsletters are all drafts — a
     * rule that fired on them would be wrong about every one.
     */
    expect(
      newslettersAwaitingSend([
        page({ id: "n1", page_type: "Newsletter", status: "Draft" }),
      ])
    ).toHaveLength(0)
  })

  it("ignores an ordinary published page", () => {
    // Only a Newsletter is expected to reach subscribers.
    expect(
      newslettersAwaitingSend([page({ id: "p1", page_type: "Blog" })])
    ).toHaveLength(0)
  })
})

describe("emptyPublishedPages", () => {
  it("finds a live page with neither blocks nor body", () => {
    expect(
      emptyPublishedPages([page({ id: "p1", block_count: 0, content: "" })]).map(
        (p) => p.id
      )
    ).toEqual(["p1"])
  })

  it("does not flag a page whose body is in blocks", () => {
    expect(
      emptyPublishedPages([page({ block_count: 3, content: "" })])
    ).toHaveLength(0)
  })

  it("does not flag a page whose body is in the content field", () => {
    /*
     * 🔴 Both shapes are in real use — the local database has published pages
     * with one block and published pages with seven, plus pages carrying a
     * content string. Checking blocks alone would dash an edge on every page
     * written the other way.
     */
    expect(
      emptyPublishedPages([page({ block_count: 0, content: "<p>hello</p>" })])
    ).toHaveLength(0)
  })

  it("treats whitespace-only content as empty", () => {
    // `''` is not the only empty string this will meet.
    expect(
      emptyPublishedPages([page({ block_count: 0, content: "   \n  " })])
    ).toHaveLength(1)
  })

  it("ignores drafts entirely", () => {
    expect(
      emptyPublishedPages([page({ status: "Draft", block_count: 0, content: "" })])
    ).toHaveLength(0)
  })
})

describe("publishedPages and failedSends", () => {
  it("counts only Published", () => {
    expect(
      publishedPages([page({ id: "a" }), page({ id: "b", status: "Archived" })]).map(
        (p) => p.id
      )
    ).toEqual(["a"])
  })

  it("counts only the sends that failed", () => {
    expect(
      failedSends([
        { id: "l1", status: "sent" },
        { id: "l2", status: "failed" },
        { id: "l3", status: "queued" },
        { id: "l4", status: "retried" },
      ]).map((l) => l.id)
    ).toEqual(["l2"])
  })
})

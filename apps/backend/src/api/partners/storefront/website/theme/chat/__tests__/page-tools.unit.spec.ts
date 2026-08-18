/**
 * The page tools let a language model write to a partner's website. The
 * safety properties below are the reason that is acceptable, so they are
 * asserted rather than asserted-in-a-comment:
 *
 *   - a page the assistant creates is ALWAYS a draft (invisible to visitors)
 *   - it never silently edits a page that is already published
 *   - it never writes to a page belonging to another tenant
 *   - it refuses to create a second page on an existing slug
 *
 * The workflows are mocked: this is about what the tools DECIDE, not whether
 * MikroORM persists. A test that needed a database would not be run often
 * enough to protect these.
 */

const createPageRun = jest.fn()
const listPageRun = jest.fn()
const createBatchRun = jest.fn()
const listBlocksRun = jest.fn()

jest.mock("../../../../../../../workflows/website/website-page/create-page", () => ({
  createPageWorkflow: () => ({ run: createPageRun }),
}))
jest.mock("../../../../../../../workflows/website/website-page/list-page", () => ({
  listPageWorkflow: () => ({ run: listPageRun }),
}))
jest.mock("../../../../../../../workflows/website/page-blocks/create-batch-blocks", () => ({
  createBatchBlocksWorkflow: () => ({ run: createBatchRun }),
}))
jest.mock("../../../../../../../workflows/website/page-blocks/list-blocks", () => ({
  listBlocksWorkflow: () => ({ run: listBlocksRun }),
}))

import { buildPageTools } from "../page-tools"

const WEBSITE_ID = "web_01"

const tools = () =>
  buildPageTools({ scope: {} as any, websiteId: WEBSITE_ID }) as any

/** The AI SDK wraps execute; call it the way the runtime does. */
const run = (t: any, input: any) => t.execute(input, {} as any)

const givenPages = (pages: any[]) =>
  listPageRun.mockResolvedValue({ result: [pages, pages.length] })

beforeEach(() => {
  jest.clearAllMocks()
  givenPages([])
  createPageRun.mockResolvedValue({ result: { id: "page_new" } })
  createBatchRun.mockResolvedValue({ result: { created: [{ id: "blk_1" }], errors: [] } })
  listBlocksRun.mockResolvedValue({ result: { blocks: [] } })
})

describe("create_page", () => {
  const blocks = [{ type: "Main", content: { body: "Hand-woven in Kashmir." } }]

  it("always creates the page as a Draft", async () => {
    await run(tools().create_page, {
      title: "Care Instructions",
      slug: "care-instructions",
      page_type: "Custom",
      blocks,
    })

    expect(createPageRun).toHaveBeenCalledTimes(1)
    const input = createPageRun.mock.calls[0][0].input
    expect(input.status).toBe("Draft")
    expect(input.website_id).toBe(WEBSITE_ID)
  })

  it("cannot be talked into publishing — status is not an input at all", async () => {
    // The model can only pass what the schema declares. If `status` ever
    // becomes an accepted field, this fails and someone has to justify it.
    const schema: any = tools().create_page.inputSchema
    const shape = schema?.shape ?? schema?._def?.shape?.()
    expect(Object.keys(shape ?? {})).not.toContain("status")
    expect(Object.keys(shape ?? {})).not.toContain("published_at")
  })

  it("says the page is a draft in its own result, so the model cannot claim it is live", async () => {
    const res: any = await run(tools().create_page, {
      title: "About",
      slug: "about",
      page_type: "About",
      blocks,
    })
    expect(res.status).toBe("Draft")
    expect(res.note).toMatch(/not visible to visitors/i)
  })

  it("normalises a slug the model wrote as prose", async () => {
    await run(tools().create_page, {
      title: "Size Guide",
      slug: "/Size Guide/",
      page_type: "Custom",
      blocks,
    })
    expect(createPageRun.mock.calls[0][0].input.slug).toBe("size-guide")
  })

  it("refuses to create a second page on an existing slug", async () => {
    givenPages([
      { id: "page_old", slug: "about", title: "About us", status: "Published" },
    ])

    const res: any = await run(tools().create_page, {
      title: "About",
      slug: "about",
      page_type: "About",
      blocks,
    })

    expect(res.created).toBe(false)
    expect(res.existing_page_id).toBe("page_old")
    expect(createPageRun).not.toHaveBeenCalled()
  })
})

describe("add_page_blocks", () => {
  const blocks = [{ type: "Main", content: { body: "More detail." } }]

  it("refuses a published page unless the edit was confirmed", async () => {
    givenPages([{ id: "page_1", title: "About", status: "Published" }])

    const res: any = await run(tools().add_page_blocks, {
      page_id: "page_1",
      blocks,
      confirm_live_edit: false,
    })

    expect(res.added).toBe(false)
    expect(res.requires_confirmation).toBe(true)
    expect(createBatchRun).not.toHaveBeenCalled()
  })

  it("proceeds on a published page once confirmed, and says the change is live", async () => {
    givenPages([{ id: "page_1", title: "About", status: "Published" }])

    const res: any = await run(tools().add_page_blocks, {
      page_id: "page_1",
      blocks,
      confirm_live_edit: true,
    })

    expect(res.added).toBe(true)
    expect(res.note).toMatch(/live/i)
  })

  it("appends after the existing blocks rather than overwriting their order", async () => {
    givenPages([{ id: "page_1", title: "About", status: "Draft" }])
    listBlocksRun.mockResolvedValue({
      result: { blocks: [{ id: "b1" }, { id: "b2" }] },
    })

    await run(tools().add_page_blocks, { page_id: "page_1", blocks, confirm_live_edit: false })

    expect(createBatchRun.mock.calls[0][0].input.blocks[0].order).toBe(2)
  })

  it("will not touch a page that is not on this partner's website", async () => {
    // The page list is website-scoped, so another tenant's id simply is not in
    // it. The refusal must not distinguish "someone else's" from "nonexistent"
    // — confirming an id exists elsewhere is itself a leak.
    givenPages([{ id: "page_mine", title: "Mine", status: "Draft" }])

    const res: any = await run(tools().add_page_blocks, {
      page_id: "page_someone_else",
      blocks,
      confirm_live_edit: true,
    })

    expect(res.added).toBe(false)
    expect(res.error).toMatch(/No page with id/)
    expect(createBatchRun).not.toHaveBeenCalled()
  })
})

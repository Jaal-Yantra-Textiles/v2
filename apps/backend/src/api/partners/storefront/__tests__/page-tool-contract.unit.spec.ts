/**
 * The storefront page tools against the validator they actually post to.
 *
 * `create_storefront_page` failed EVERY call with
 * `Field 'content' is required`: the registry row never mentioned `content`,
 * so the tool could not satisfy its own route no matter what the model sent —
 * `content` was absent from `bodyParams` too, so even a model that guessed
 * right had the field stripped by the dispatcher on the way out.
 *
 * That is not a typo, it is a missing contract. These tests assert the tool
 * rows and the zod schema agree on three things a caller cannot discover for
 * itself: which fields are required, which fields survive the dispatcher, and
 * which literal values the enums accept.
 */
import { PARTNER_MCP_TOOLS } from "../../mcp/lib/registry"
import {
  PAGE_TYPES,
  PAGE_STATUSES,
  postPagesSchema,
  updatePageSchema,
} from "../../../admin/websites/[id]/pages/validators"

const tool = (name: string) => {
  const def = PARTNER_MCP_TOOLS.find((t) => t.name === name)
  if (!def) throw new Error(`${name} is not registered`)
  return def as any
}

/** The keys a zod object schema requires (no default, not optional). */
const requiredKeys = (shape: Record<string, any>) =>
  Object.entries(shape)
    .filter(([, v]) => !v.isOptional?.())
    .map(([k]) => k)
    .sort()

// postPagesSchema is a union of "one page" and "{ pages: [...] }"; the tool
// posts a single page, so that is the member its contract must match.
const pageShape = (postPagesSchema as any).options[0].shape

describe("create_storefront_page ↔ postPagesSchema", () => {
  const def = tool("create_storefront_page")

  it("requires every field the route requires", () => {
    // The bug, stated as a test: `content` is required by the route and was
    // absent here, so the tool 400'd on every call.
    const missing = requiredKeys(pageShape).filter(
      (k) => !(def.inputSchema.required ?? []).includes(k)
    )
    expect(missing).toEqual([])
  })

  it("forwards every field it asks for", () => {
    // A field in inputSchema but not bodyParams is silently dropped by the
    // dispatcher — the model does everything right and the route still 400s.
    const declared = Object.keys(def.inputSchema.properties).filter(
      (k) => !(def.pathParams ?? []).includes(k)
    )
    const dropped = declared.filter((k) => !def.bodyParams.includes(k))
    expect(dropped).toEqual([])
  })

  it("only forwards fields the validator accepts", () => {
    // `blocks` was advertised here and stripped by zod on arrival: the model
    // sends a laid-out page, the route stores a blank one, nothing errors.
    const unknown = def.bodyParams.filter((k: string) => !(k in pageShape))
    expect(unknown).toEqual([])
  })

  it("offers exactly the enum values the route accepts", () => {
    expect(def.inputSchema.properties.page_type.enum).toEqual([...PAGE_TYPES])
    expect(def.inputSchema.properties.status.enum).toEqual([...PAGE_STATUSES])
  })

  it("does not describe the values in the wrong case", () => {
    // The row used to say "e.g. 'home'" / "e.g. 'published'" against a
    // capitalised enum — an invitation to a 400.
    expect(def.description).not.toMatch(/'home'|'published'/)
  })

  it("passes a realistic model payload through the real validator", () => {
    const payload = {
      title: "About us",
      slug: "about-us",
      content: "We are a weaving collective in Kashmir.",
      page_type: "About",
      status: "Draft",
    }
    expect(() => postPagesSchema.parse(payload)).not.toThrow()
  })

  it("still rejects the payload the tool used to send", () => {
    // Exactly what the old row could produce: no content, no slug, lowercase
    // page_type. If this ever passes, the validator moved and the tool's
    // required list should move with it.
    expect(() =>
      postPagesSchema.parse({ title: "About us", page_type: "about" })
    ).toThrow()
  })
})

describe("update_storefront_page ↔ updatePageSchema", () => {
  const def = tool("update_storefront_page")

  it("forwards every field it asks for, and nothing the validator drops", () => {
    const shape = (updatePageSchema as any).shape
    const declared = Object.keys(def.inputSchema.properties).filter(
      (k) => !(def.pathParams ?? []).includes(k)
    )
    expect(declared.filter((k) => !def.bodyParams.includes(k))).toEqual([])
    expect(def.bodyParams.filter((k: string) => !(k in shape))).toEqual([])
  })

  it("offers exactly the enum values the route accepts", () => {
    expect(def.inputSchema.properties.page_type.enum).toEqual([...PAGE_TYPES])
    expect(def.inputSchema.properties.status.enum).toEqual([...PAGE_STATUSES])
  })
})

describe("one page vocabulary", () => {
  it("is defined once and imported, never restated", () => {
    // The theme-chat tools kept a third copy of PAGE_TYPES; the registry kept
    // a fourth in prose. Both now read this list.
    const pageTools = require("fs").readFileSync(
      require("path").join(__dirname, "../website/theme/chat/page-tools.ts"),
      "utf8"
    )
    expect(pageTools).toContain("import { PAGE_TYPES }")
    expect(pageTools).not.toMatch(/const PAGE_TYPES = \[/)
  })
})

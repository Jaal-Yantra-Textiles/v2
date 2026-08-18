/**
 * The failures the original 26 unit tests could not see (review of #1345).
 *
 * Every defect fixed here was invisible to a pure-function test: the module was
 * registered in neither config, the read path could fail a turn, entries were
 * written under domains their reader can never ask for, and a stale summary was
 * injected as though it were current. These assert the WIRING, which is where
 * all four lived.
 */
import fs from "fs"
import path from "path"
import { toolNameToDomain } from "../domains"
import { formatPriorContext, isFresh, loadAndFormatContext } from "../inject"
import { resolveContextCache } from "../resolve"
import { extractContextFromTurn } from "../extract"
import { ASSISTANT_CONTEXT_CACHE_MODULE } from "../../../modules/assistant-context-cache"
import { ADMIN_MCP_TOOLS } from "../../../api/admin/mcp/lib/registry"
import { PARTNER_MCP_TOOLS } from "../../../api/partners/mcp/lib/registry"
import { SELECTABLE_DOMAINS as ADMIN_DOMAINS } from "../../../api/admin/mcp/lib/tool-slice"
import { SELECTABLE_DOMAINS as PARTNER_DOMAINS } from "../../../api/partners/mcp/lib/tool-slice"

const configText = (file: string) =>
  fs.readFileSync(path.join(__dirname, "../../../../", file), "utf8")

describe("module registration", () => {
  // The blocker: an unregistered module makes `scope.resolve` throw on a path
  // that runs before streamText — every assistant turn 500s — and its migration
  // is never discovered, so the table does not exist either.
  it.each(["medusa-config.ts", "medusa-config.prod.ts"])(
    "registers the cache module in %s",
    (file) => {
      expect(configText(file)).toContain("./src/modules/assistant-context-cache")
    }
  )
})

describe("resolveContextCache", () => {
  it("returns null instead of throwing when the module is missing", () => {
    const warn = jest.fn()
    const scope = {
      resolve: () => {
        throw new Error("Could not resolve 'assistantContextCache'")
      },
    }
    expect(resolveContextCache(scope, { warn })).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it("returns the service when it is registered", () => {
    const svc = { getContextForPrincipal: jest.fn() }
    const scope = { resolve: (k: string) => (k === ASSISTANT_CONTEXT_CACHE_MODULE ? svc : null) }
    expect(resolveContextCache(scope)).toBe(svc)
  })
})

describe("loadAndFormatContext", () => {
  it("returns undefined rather than throwing when the read fails", async () => {
    // A missing table or a DB blip must look exactly like a cache miss: the
    // turn proceeds without prior context.
    const cacheService = {
      getContextForPrincipal: async () => {
        throw new Error('relation "assistant_context_cache" does not exist')
      },
    }
    await expect(
      loadAndFormatContext(cacheService, "usr_1", "admin", ["orders"])
    ).resolves.toBeUndefined()
  })
})

describe("domain agreement between the writer and the reader", () => {
  const SURFACES = [
    { surface: "admin" as const, tools: ADMIN_MCP_TOOLS, selectable: ADMIN_DOMAINS },
    { surface: "partner" as const, tools: PARTNER_MCP_TOOLS, selectable: PARTNER_DOMAINS },
  ]

  it.each(SURFACES)(
    "never writes a $surface entry under a domain that surface cannot ask for",
    ({ surface, tools, selectable }) => {
      // The read path asks for the domains its SLICER matched. A row written
      // under any other key is unreadable forever — and silent, because a
      // cache that never hits looks exactly like a cache that never helps.
      const wrong = tools
        .map((t) => ({ name: t.name, domain: toolNameToDomain(t.name, surface) }))
        .filter(
          (r) => r.domain && !(selectable as readonly string[]).includes(r.domain)
        )
      expect(wrong).toEqual([])
    }
  )

  it("routes a store tool to each surface's OWN domain for it", () => {
    // The same tool name, two different right answers: admin classifies
    // /admin/stores as catalog, the partner slicer has a real storefront
    // domain. A single shared heuristic had to be wrong on one of them.
    expect(toolNameToDomain("list_stores", "admin")).toBe("catalog")
    expect(toolNameToDomain("list_stores", "partner")).toBe("storefront")
  })

  it("drops a domain the surface does not have rather than inventing one", () => {
    // "marketing" is an admin-only domain; a partner turn must not write it.
    expect(toolNameToDomain("list_publishing_campaigns", "partner")).toBeUndefined()
  })

  it("keeps the surface-blind heuristic working for callers without one", () => {
    expect(toolNameToDomain("list_orders")).toBe("orders")
  })

  it("threads the surface all the way through extraction", () => {
    const [entry] = extractContextFromTurn(
      [{ toolName: "list_stores", output: { stores: [{ id: "store_1" }] } }],
      "admin"
    )
    expect(entry.domain).toBe("catalog")
  })
})

describe("staleness", () => {
  const row = (domain: string, ageMs: number) => ({
    domain,
    entity_ids: ["order_1"],
    summary: "5 orders found",
    updated_at: new Date(Date.now() - ageMs),
  })

  it("drops a volatile domain after an hour", () => {
    expect(isFresh(row("orders", 30 * 60 * 1000))).toBe(true)
    expect(isFresh(row("orders", 2 * 60 * 60 * 1000))).toBe(false)
  })

  it("keeps a slow-moving domain for a day", () => {
    expect(isFresh(row("catalog", 6 * 60 * 60 * 1000))).toBe(true)
    expect(isFresh(row("catalog", 26 * 60 * 60 * 1000))).toBe(false)
  })

  it("injects nothing at all when every entry is stale", () => {
    // Not merely "shows an old timestamp": a three-week-old summary of a
    // volatile domain is a wrong answer waiting to be stated as a fact.
    expect(formatPriorContext([row("orders", 21 * 24 * 60 * 60 * 1000)])).toBeUndefined()
  })

  it("drops an unparseable timestamp instead of treating it as current", () => {
    expect(isFresh({ ...row("orders", 0), updated_at: "not-a-date" })).toBe(false)
  })

  it("tells the model the block is a pointer, not a source of truth", () => {
    const block = formatPriorContext([row("orders", 60 * 1000)])!
    expect(block).toContain("POINTER, not a source of truth")
    expect(block).not.toContain("avoid re-fetching the same data")
  })
})

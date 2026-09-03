import { ADMIN_MCP_TOOLS } from "../registry"
import { PARTNER_MCP_TOOLS } from "../../../../partners/mcp/lib/registry"

/**
 * The two quote rows must not contradict each other about revocation (#1452).
 *
 * `mint_quote`'s `sideEffects` told the model to "revoke the old quote first",
 * while `revoke_quote`'s own description — three lines below it — said that is
 * no longer needed because the mint supersedes the previous quote itself
 * (#1435). A model reads the row for the tool it is about to CALL, so the
 * stale half was on the write: it revoked a live buyer link for nothing, in
 * the gap before the new quote was minted.
 *
 * A registry row is prose a model acts on, so nothing typechecks it and no
 * route test can catch a sentence that has gone false. This spec is the check.
 */
const rows = [
  ["admin", ADMIN_MCP_TOOLS],
  ["partner", PARTNER_MCP_TOOLS],
] as const

describe.each(rows)("%s mint_quote — revocation guidance", (_surface, tools) => {
  const mint = (tools as any[]).find((t) => t.name === "mint_quote")
  const text = [
    mint?.description,
    mint?.sideEffects,
    ...(Array.isArray(mint?.nextSteps) ? [] : []),
  ]
    .filter(Boolean)
    .join(" ")

  it("is registered", () => {
    expect(mint).toBeTruthy()
  })

  it("never prescribes revoking the previous quote before re-minting", () => {
    // The literal sentence that shipped, and the shape of it — a rephrase that
    // still tells the model to revoke first is the same defect.
    expect(text).not.toMatch(/revoke the old quote first/i)
    expect(text).not.toMatch(/revoke[^.]{0,40}before (re-?)?(minting|quoting)/i)
  })

  it("says the mint supersedes the previous quote itself", () => {
    // The positive half: removing the wrong sentence without stating what is
    // actually true leaves the model to guess, and it guessed revoke before.
    expect(text).toMatch(/supersede/i)
  })
})

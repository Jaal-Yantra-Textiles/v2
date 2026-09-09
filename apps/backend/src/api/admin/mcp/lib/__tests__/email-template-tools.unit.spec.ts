/**
 * The email-template tools — the outbound email surface.
 *
 * These assert the two things that actually break in production: a tool that
 * exists but can never be reached (wrong domain, no keyword), and a write tool
 * that isn't gated. Both fail silently — the model just says it can't do it.
 *
 * Plus the two traps specific to this family:
 *  - the route handler DESTRUCTURES `order` and `fields` and then drops them,
 *    so the list tool must not advertise a sort it will silently ignore; and
 *  - the create route's required fields are the route's zod contract, so the
 *    tool's `required` must carry every one of them or a model following the
 *    schema gets a 400 (#1348/#1371).
 */
import { ADMIN_MCP_TOOLS } from "../registry"
import {
  selectAdminToolSlice,
  toolDomain,
  matchDomains,
} from "../tool-slice"

const byName = (name: string) => {
  const def = ADMIN_MCP_TOOLS.find((t) => t.name === name)
  if (!def) {
    throw new Error(`tool ${name} is not registered`)
  }
  return def
}

const NEW_TOOLS = [
  "list_email_templates",
  "get_email_template",
  "create_email_template",
  "update_email_template",
  "delete_email_template",
]

describe("registry — email template tools", () => {
  it("registers every new tool exactly once", () => {
    for (const name of NEW_TOOLS) {
      const matches = ADMIN_MCP_TOOLS.filter((t) => t.name === name)
      expect([name, matches.length]).toEqual([name, 1])
    }
  })

  it("gates every mutation behind write + confirm", () => {
    for (const name of [
      "create_email_template",
      "update_email_template",
      "delete_email_template",
    ]) {
      const def = byName(name)
      expect([name, def.write === true, def.sensitive === true]).toEqual([
        name,
        true,
        true,
      ])
    }
  })

  it("does NOT gate reads", () => {
    for (const name of ["list_email_templates", "get_email_template"]) {
      expect([name, !!byName(name).write]).toEqual([name, false])
    }
  })

  it("declares every :param in the path as a pathParam", () => {
    for (const name of NEW_TOOLS) {
      const def = byName(name)
      const placeholders = (def.path?.match(/:(\w+)/g) ?? []).map((p) => p.slice(1))
      expect([name, def.pathParams ?? []]).toEqual([name, placeholders])
    }
  })

  it("only forwards body params the tool's own schema declares", () => {
    for (const name of NEW_TOOLS) {
      const def = byName(name)
      const props = Object.keys(def.inputSchema?.properties ?? {})
      for (const key of def.bodyParams ?? []) {
        expect([name, key, props.includes(key)]).toEqual([name, key, true])
      }
    }
  })

  it("requires exactly what the create route's validator requires", () => {
    // EmailTemplateSchema (the route's body validator) makes name, from,
    // template_key, subject, html_content and template_type required. A
    // model following the tool's own `required` list must never be able to
    // build a call the route rejects (#1348).
    const def = byName("create_email_template")
    expect([...(def.inputSchema?.required ?? [])].sort()).toEqual(
      [
        "name",
        "from",
        "template_key",
        "subject",
        "html_content",
        "template_type",
      ].sort()
    )
  })

  it("never advertises a sort the route silently drops", () => {
    // The GET handler destructures `order` and `fields` and then never
    // forwards them — declaring them would silently ignore the model's
    // request while reporting ok, the same defect class as #1172.
    const def = byName("list_email_templates")
    expect(def.queryParams).not.toContain("order")
    expect(def.queryParams).not.toContain("fields")
    for (const key of def.queryParams ?? []) {
      expect(key in (def.inputSchema?.properties ?? {})).toBe(true)
    }
  })

  it("gives the update and delete tools a dry-run preview of the template", () => {
    // Both write the row a sender will render — the dry-run must show the
    // current template so the confirmation card is a review, not a blank.
    for (const name of ["update_email_template", "delete_email_template"]) {
      const def = byName(name)
      expect([name, def.previewPath]).toEqual([name, def.path])
    }
  })
})

describe("tool-slice — reachability", () => {
  it("classifies every email-template tool as marketing", () => {
    for (const name of NEW_TOOLS) {
      expect([name, toolDomain(byName(name))]).toEqual([name, "marketing"])
    }
  })

  it("lights up for how an operator asks about outbound email", () => {
    for (const ask of [
      "what does the partner task email say?",
      "edit the order confirmation email",
      "add a newsletter template",
      "retire the old welcome email",
    ]) {
      expect([ask, matchDomains(ask)]).toEqual([ask, expect.arrayContaining(["marketing"])])
    }
  })

  it("loads the whole family for one email ask", () => {
    const slice = selectAdminToolSlice(
      "update the footer on the order confirmation email and deactivate the old one",
      ADMIN_MCP_TOOLS as any
    )
    for (const name of [
      "list_email_templates",
      "get_email_template",
      "update_email_template",
    ]) {
      expect([name, slice.names.includes(name)]).toEqual([name, true])
    }
  })
})

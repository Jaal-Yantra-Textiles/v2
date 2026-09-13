/**
 * Seed one design work-order in the "offered" phase for the #2018 e2e.
 *
 * Offered is the phase the rework is ABOUT: the partner has not accepted yet,
 * so the action block must say "Accept this run" and the spec/sizes/BOM must be
 * collapsed behind Details. Any later phase reveals everything and proves less.
 *
 * Writes to the LOCAL backend only (localhost:9000). Prints JSON on stdout.
 */
const BACKEND = process.env.MEDUSA_BACKEND_URL || "http://localhost:9000"
const ADMIN_KEY = process.env.MEDUSA_ADMIN_KEY
if (!ADMIN_KEY) {
  console.error("MEDUSA_ADMIN_KEY is required (the local sk_... admin key)")
  process.exit(1)
}
const adminAuth = "Basic " + Buffer.from(`${ADMIN_KEY}:`).toString("base64")

const req = async (path, { method = "GET", body, headers = {} } = {}) => {
  const res = await fetch(`${BACKEND}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = text }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`)
  }
  return json
}

const admin = (path, opts = {}) =>
  req(path, { ...opts, headers: { ...opts.headers, authorization: adminAuth } })

const unique = Date.now()
const email = `e2e-partner-${unique}@jyt.test`
const password = "supersecret"

// ── partner, with credentials the test controls ──────────────────────────
await req("/auth/partner/emailpass/register", { method: "POST", body: { email, password } })
const first = await req("/auth/partner/emailpass", { method: "POST", body: { email, password } })
const created = await req("/partners", {
  method: "POST",
  body: {
    name: `E2E Partner ${unique}`,
    handle: `e2e-partner-${unique}`,
    admin: { email, first_name: "E2E", last_name: "Partner" },
  },
  headers: { authorization: `Bearer ${first.token}` },
})
const partnerId = created.partner.id

// 🔴 Without this the UI login goes nowhere. The API happily issues a token for
// an unverified partner, so `POST /auth/partner/emailpass` succeeding proves
// nothing about the SCREEN — the login page swaps the sign-in form for a
// "verify your email" panel and simply never navigates.
await admin(`/admin/partners/${partnerId}/bypass-email-verification`, { method: "POST", body: {} })

// ── a design, and a run dispatched to that partner ───────────────────────
const design = await admin("/admin/designs", {
  method: "POST",
  body: {
    name: `E2E Jacket ${unique}`,
    description: "Seeded for the #2018 action-first e2e",
    design_type: "Original",
    status: "Approved",
    priority: "Medium",
  },
})
const designId = design.design.id

// A template is what makes the run DISPATCH; without it the run never reaches
// sent_to_partner and the partner sees no work at all.
const tplName = `e2e-tpl-${unique}`
await admin("/admin/task-templates", {
  method: "POST",
  body: {
    name: tplName,
    description: `${tplName} template`,
    priority: "medium",
    estimated_duration: 60,
    required_fields: {},
    eventable: false,
    notifiable: false,
    message_template: "",
    // No `category`: the admin route reads it as a category_ID relationship,
    // so a name that is not an existing category 404s. Local templates carry
    // category_id: null, so omitting it is the normal shape.
    metadata: { workflow_type: "production_run" },
  },
})

const run = await admin(`/admin/designs/${designId}/production-runs`, {
  method: "POST",
  body: {
    assignments: [
      { partner_id: partnerId, quantity: 2, role: "stitching", template_names: [tplName] },
    ],
  },
})

const child = run.children?.[0]
console.log(JSON.stringify({
  email, password, partnerId, designId,
  runId: child?.id,
  runStatus: child?.status,
  designName: design.design.name,
}, null, 2))

import { model } from "@medusajs/framework/utils"

/**
 * One read of a source of evidence about a partner, and what it PROPOSED
 * (#2249).
 *
 * Two kinds today:
 *   - `website` — the partner's own site (Shopify feed, WooCommerce, pages).
 *   - `records` — OUR records: runs they completed, cloth they supplied us,
 *     products they list with us. The strongest evidence we hold, and for most
 *     partners the only evidence: a website is rarer than a finished run.
 *
 * A scan writes nothing to the capability library. It stores its proposals
 * here so an operator looks before anything lands on the partner, and so the
 * commit acts on what was actually read rather than on whatever a caller sends
 * back — a proposal edited in transit would otherwise be filed under a source
 * that never said it.
 *
 * `proposal` is a snapshot of the scan's output, not a field anything decides
 * on; the decisions are the sample/knowledge rows a commit creates.
 */
const PartnerCapabilityScan = model
  .define("partner_capability_scan", {
    id: model.id({ prefix: "pcscan" }).primaryKey(),

    partner_id: model.text().searchable(),

    kind: model.enum(["website", "records"]),

    /** A website scan: the URL as typed, and the origin it resolved to. */
    url: model.text().nullable(),
    origin: model.text().nullable(),

    /** How the evidence was read. */
    platform: model.enum(["shopify", "html", "records"]),

    status: model.enum(["proposed", "committed"]).default("proposed"),

    /** { samples: [...], knowledge: [...], summary, warnings } */
    proposal: model.json(),

    committed_at: model.dateTime().nullable(),

    /** Proposal keys already written → the row each became, so a second commit cannot duplicate. */
    committed_keys: model.json().nullable(),

    metadata: model.json().nullable(),
  })
  .indexes([{ on: ["partner_id"], name: "idx_partner_capability_scan_partner" }])

export default PartnerCapabilityScan

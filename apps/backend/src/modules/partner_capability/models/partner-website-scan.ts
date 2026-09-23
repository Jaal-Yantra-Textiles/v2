import { model } from "@medusajs/framework/utils"

/**
 * One read of a partner's website, and what it PROPOSED (#2249).
 *
 * A scan writes nothing to the capability library. It stores its proposals
 * here so an operator can look before anything lands on the partner, and so
 * the commit acts on what was actually read rather than on whatever a caller
 * sends back — a proposal edited in transit would otherwise be filed with
 * `source: "website"` as if the site had said it.
 *
 * `proposal` is a snapshot of the scan's output, not a field anything decides
 * on; the decisions are the sample/knowledge rows a commit creates.
 */
const PartnerWebsiteScan = model
  .define("partner_website_scan", {
    id: model.id({ prefix: "pwscan" }).primaryKey(),

    partner_id: model.text().searchable(),

    /** The URL as the operator typed it, and the origin it resolved to. */
    url: model.text(),
    origin: model.text(),

    /** How the catalogue was read: a Shopify `/products.json`, or page HTML. */
    platform: model.enum(["shopify", "html"]),

    status: model.enum(["proposed", "committed"]).default("proposed"),

    /** { samples: [...], knowledge: [...], summary, warnings } */
    proposal: model.json(),

    committed_at: model.dateTime().nullable(),

    /** Proposal keys already written, so a second commit cannot duplicate. */
    committed_keys: model.json().nullable(),

    metadata: model.json().nullable(),
  })
  .indexes([{ on: ["partner_id"], name: "idx_partner_website_scan_partner" }])

export default PartnerWebsiteScan

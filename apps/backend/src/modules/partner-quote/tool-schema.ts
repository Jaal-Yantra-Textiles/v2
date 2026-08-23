/**
 * The MCP/assistant-facing description of a quote mint (#1439).
 *
 * ## Why this lives with the module and not in a registry
 *
 * BOTH surfaces mint: a partner quotes their own catalogue, an admin quotes on
 * a partner's behalf. A body vocabulary written out twice is one edit away from
 * the two assistants believing different things about what a quote is — which
 * is the shape of #1348, where an MCP row and its route validator disagreed and
 * the field was dropped in silence.
 *
 * ## The list is load-bearing, not documentation
 *
 * The dispatcher's body assembly is a pure allowlist walk over
 * `bodyParams`. A field the model supplies that is missing from this list is
 * **silently stripped**: no error, no warning, `ok: true`, and a quote minted
 * on terms nobody chose. `dry_run` cannot reveal it either, because the plan is
 * built from the already-picked body.
 *
 * That is not hypothetical here. `deposit_pct` carries a comment in the route
 * validator saying exactly this about `zodValidator`'s `.strict()`, and three
 * partner MCP tools once shipped in a state where they could never succeed
 * (#1394) because the tool's own `required` list was the thing that lied.
 *
 * So the coverage of this list against the real Zod validator is asserted by
 * `quote-tool-field-coverage.unit.spec.ts`, which imports the validator rather
 * than transcribing it. Adding a field to the route without adding it here
 * fails that test.
 */

/**
 * Body keys the dispatcher forwards to the mint route, in registry order.
 *
 * ⚠️ `partner_id` is NOT here. It is the admin surface's own addition and is
 * declared beside the admin tool, because the partner surface must never accept
 * it — a partner naming another partner's id is the one field that would let
 * them freeze prices onto someone else's customer group.
 */
export const QUOTE_MINT_BODY_PARAMS = [
  "buyer_email",
  "recipient_name",
  "recipient_company",
  "buyer_tax_id",
  "buyer_tax_id_type",
  "partner_note",
  "lines",
  "destination_country_code",
  "destination_postal_code",
  "destination_city",
  "currency_code",
  "region_id",
  "carrier",
  "ttl_days",
  "deposit_pct",
  "duties_prepaid",
  "duty_total",
  "duty_basis",
  "duty_rate_percent",
  "import_tax_rate_percent",
  "import_tax_total",
  "ddp_fee_total",
  "freight_override_amount",
  "freight_basis",
]

/**
 * Guidance the model needs BEFORE it calls the tool, not after it fails.
 *
 * Every sentence here corresponds to a refusal the route will otherwise issue,
 * and a refusal the assistant cannot diagnose from the error alone.
 */
export const QUOTE_MINT_WRITE_GUIDANCE = [
  "Minting a quote FREEZES prices into a real price list scoped to this buyer, sends them an email, and gives them a link they can accept and pay a deposit against. Treat it as a commercial commitment, not a calculation.",
  "Run the readiness preflight first (`check_quote_readiness`). It reports EVERY blocking problem at once; minting reports the same set but after the buyer's expectations have been set.",
  "Freight on a cross-border lane usually cannot be rated: the carrier answers 'no serviceable couriers available for given weight'. When that happens the mint REFUSES until you supply `freight_override_amount` — look up the real carrier rate (DHL and the like) and pass it with `freight_basis` saying where it came from. It is shown to the buyer as quoted by hand.",
  "`duties_prepaid: true` is a promise that the buyer pays nothing at their border. It requires a duty figure alongside it — either `duty_rate_percent` (preferred, applied to the basket actually priced) or `duty_total`. Promising DDP with no amount funds it out of margin.",
  "Tax follows the SELLER's jurisdiction, never the buyer's. An export from India is zero-rated whatever the destination's VAT rate is; do not add destination VAT to the lines.",
].join(" ")

/**
 * JSON-Schema properties for the mint body. Merged into each surface's own
 * `obj({...})` so the surface keeps ownership of `partner_id` and of which
 * fields it marks required.
 */
export const quoteMintSchemaProps = () => ({
  buyer_email: {
    type: "string",
    description:
      "The buyer's email. The quote link is sent here on mint — there is no second chance to retrieve the raw token.",
  },
  recipient_name: {
    type: "string",
    description: "Buyer contact name, e.g. 'Priya Raman'. Shown on the quote.",
  },
  recipient_company: {
    type: "string",
    description: "Buyer's company, shown on the quote document.",
  },
  buyer_tax_id: {
    type: "string",
    description:
      "The buyer's own tax registration as they stated it, e.g. a VAT number. Recorded on the document; it changes NOTHING about the price or the tax charged.",
  },
  buyer_tax_id_type: {
    type: "string",
    description: "What kind of registration `buyer_tax_id` is, e.g. 'vat', 'gst'.",
  },
  partner_note: {
    type: "string",
    description:
      "A note from the seller shown to the buyer on the quote page. Use it for terms the numbers cannot carry (lead time, packing, MOQ reasoning).",
  },
  lines: {
    type: "array",
    description:
      "The basket. Every line names EITHER `variant_id` OR `design_id` — a design is resolved to the single variant it is sold through, and refused when that is not decidable. The whole basket is quoted as ONE consignment, so freight is charged once across all of it.",
    items: {
      type: "object",
      properties: {
        variant_id: { type: "string", description: "Variant to quote." },
        design_id: {
          type: "string",
          description:
            "Quote this design instead; the server resolves the variant behind it.",
        },
        quantity: {
          type: "number",
          description:
            "Units of this line. Prices are resolved AT THIS QUANTITY, so a tier price only appears if the quantity reaches it.",
        },
        position: { type: "number", description: "Display order on the quote." },
        note: { type: "string", description: "Per-line note for the buyer." },
        discount_percent: {
          type: "number",
          description: "0-100 off the live catalogue price at this line's quantity.",
        },
        override_unit_amount: {
          type: "number",
          description:
            "A flat unit price in the partner store's default currency. Beats the catalogue and any discount.",
        },
      },
      required: ["quantity"],
    },
  },
  destination_country_code: {
    type: "string",
    description:
      "Two-letter destination country, e.g. 'de'. Decides the freight lane AND whether this is a domestic supply or a zero-rated export.",
  },
  destination_postal_code: {
    type: "string",
    description: "Destination postcode — carriers rate on it, so freight is worse without it.",
  },
  destination_city: { type: "string", description: "Destination city." },
  currency_code: {
    type: "string",
    description:
      "Quote currency, e.g. 'eur'. Must match the region's currency; a rate resolved in another currency is refused rather than converted.",
  },
  region_id: {
    type: "string",
    description: "Region whose prices and tax basis apply, e.g. 'reg_...'.",
  },
  carrier: {
    type: "string",
    description:
      "Restrict freight rating to one carrier. Defaults to the partner's own carrier — do not set this without a reason.",
  },
  ttl_days: {
    type: "number",
    description:
      "How long the quote stands, in days. Drives the price list's expiry, so the frozen prices genuinely stop applying.",
  },
  deposit_pct: {
    type: "number",
    description:
      "Deposit share of the deal, 0-100. Omit to fall through to the partner's default and then the platform's 30%. `0` is a real answer meaning invoice the lot later; 100 means paid up front.",
  },
  duties_prepaid: {
    type: "boolean",
    description:
      "DDP: we pay the destination duty and import tax and the buyer owes nothing on arrival. A PROMISE — it only holds if the shipment actually clears DDP. Requires a duty figure alongside it.",
  },
  duty_total: {
    type: "number",
    description:
      "The duty we undertake to pay, in the quote currency. Prefer `duty_rate_percent`, which is applied to the basket actually priced.",
  },
  duty_basis: {
    type: "string",
    description:
      "Where the duty figure came from, e.g. 'DHL tariff quote 24 Aug, HS 6117.10'. Evidence for a number we are liable for.",
  },
  duty_rate_percent: {
    type: "number",
    description:
      "Duty as a percentage of the goods+freight value. Preferred over `duty_total`. Above 100 is a typo, and a typo here is a liability we take on.",
  },
  import_tax_rate_percent: {
    type: "number",
    description:
      "Destination import VAT/GST as a percentage, applied to goods+freight+duty. Usually the LARGEST of the three DDP charges — a 21% import VAT dwarfs an 8% duty.",
  },
  import_tax_total: {
    type: "number",
    description: "Destination import VAT/GST as an amount, if the rate form is not usable.",
  },
  ddp_fee_total: {
    type: "number",
    description: "The carrier's advance/disbursement fee for clearing DDP. An amount, never a rate.",
  },
  freight_override_amount: {
    type: "number",
    description:
      "Freight named by hand, in the quote currency. REQUIRED on any lane the carrier cannot rate — the mint refuses otherwise rather than fall back to a flat rate that does not change with weight. Shown to the buyer as quoted by hand.",
  },
  freight_basis: {
    type: "string",
    description:
      "Where the hand-typed freight came from, e.g. 'DHL Express Worldwide, Srinagar to Berlin, 3.05 kg, quoted 24 Aug'. Always send it with `freight_override_amount`.",
  },
})

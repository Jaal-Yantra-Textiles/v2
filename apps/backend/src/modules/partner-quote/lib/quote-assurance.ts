/**
 * Why buy this here, and what exactly you pay (#1428 follow-up).
 *
 * ## Two claims, and the line between them
 *
 * The persuasive half — artisanal, verified, made by the hands that made it —
 * is only worth saying if every sentence is a FACT we hold. "Verified" is a
 * boolean on the partner. "Made to order" is on their onboarding profile.
 * Neither is an adjective anyone here gets to add.
 *
 * 🔴 A trust badge that is not backed by a check is the single most damaging
 * thing on a page like this. If it ever appears on an unverified workshop the
 * word stops meaning anything on the verified ones too — so every point below
 * is gated on the fact, and a maker with no facts gets no points rather than
 * generic ones.
 *
 * ## The fee structure is what the BUYER pays — never the partner's terms
 *
 * 🔴 `partner_onboarding_profile.commission_bps` exists and must NOT appear
 * here. That is the commercial arrangement between the platform and the maker;
 * publishing it to the maker's own customer hands them the maker's net and an
 * argument for going direct. `buildProvenance` already excludes commercial
 * terms and price bands from public-safe facts for exactly this reason, and
 * this block keeps the same line.
 *
 * What a buyer is owed is the composition of THEIR number: what is in the
 * total, and — the part everyone gets wrong — what is not.
 *
 * 🔴 `no_further_charges` is false unless duty is genuinely prepaid. A
 * non-DDP cross-border order lands the buyer with duty, import VAT and a
 * carrier advancement fee that together run to roughly a third of goods value
 * (#1447). Saying "nothing further to pay" over that is not optimism, it is a
 * false statement about money.
 */

export type QuoteAssurancePoint = {
  key: "artisanal" | "verified" | "direct" | "held"
  title: string
  body: string
}

export type QuoteAssuranceCharge = {
  key: string
  label: string
  /** Null when there is no amount to state — the note carries the fact. */
  amount: number | null
  note: string
  /** True when it is already inside the total shown on this page. */
  included: boolean
}

export type QuoteAssurance = {
  maker_name: string | null
  verified: boolean
  points: QuoteAssurancePoint[]
  charges: QuoteAssuranceCharge[]
  currency_code: string
  /** True ONLY when nothing beyond the shown total is payable by the buyer. */
  no_further_charges: boolean
}

/** A provenance row's value, by key. Absent rows are absent, never blank. */
const rowValue = (rows: any[] | null | undefined, key: string): string | null => {
  const row = (rows ?? []).find((r) => r?.key === key)
  const value = String(row?.value ?? "").trim()
  return value || null
}

export function composeQuoteAssurance(input: {
  currency_code: string
  producer?: { name?: string | null; is_verified?: boolean } | null
  provenance?: { maker_name?: string | null; rows?: any[] | null } | null
  money?: { subtotal?: number | null; freight?: number | null } | null
  tax?: { total?: number | null; inclusive?: boolean | null; status?: string | null } | null
  duty?: {
    prepaid?: boolean
    total?: number | null
    import_tax?: number | null
    carrier_fee?: number | null
  } | null
  /** True when the destination is not the origin — duty only bites then. */
  cross_border: boolean
  expires_in_days?: number | null
}): QuoteAssurance {
  const rows = input.provenance?.rows ?? []
  const verified = Boolean(input.producer?.is_verified)
  const makerName =
    input.producer?.name ?? input.provenance?.maker_name ?? null

  const points: QuoteAssurancePoint[] = []

  // Each gated on a fact. A maker with none of them gets no points, which is
  // the honest outcome — not a generic paragraph about craftsmanship.
  const weaving = rowValue(rows, "weaving")
  const production = rowValue(rows, "made_to_order")
  const makerType = rowValue(rows, "maker_type")

  if (weaving || production || makerType) {
    points.push({
      key: "artisanal",
      title: "Made by hand, by a named workshop",
      body: [
        makerName ? `${makerName} is a real workshop, not a trading desk.` : null,
        production ? `Production: ${production.toLowerCase()}.` : null,
        weaving ? `Weaving: ${weaving.toLowerCase()}.` : null,
      ]
        .filter(Boolean)
        .join(" "),
    })
  }

  if (verified) {
    points.push({
      key: "verified",
      title: "We have verified this workshop",
      body:
        "Their identity, their registration and their ability to produce at this scale were checked by us before they could quote you.",
    })
  }

  if (makerName) {
    points.push({
      key: "direct",
      title: "You are buying their own work",
      body: `Your order is produced and dispatched by ${makerName}. We handle the contract, the payment and the freight so you deal with one party.`,
    })
  }

  if (input.expires_in_days !== null && input.expires_in_days !== undefined) {
    points.push({
      key: "held",
      title: "This price is held for you",
      body: `These rates were prepared for your company and hold for ${input.expires_in_days} more day${input.expires_in_days === 1 ? "" : "s"}.`,
    })
  }

  // ---- What the buyer actually pays ---------------------------------------
  const charges: QuoteAssuranceCharge[] = [
    {
      key: "goods",
      label: "The goods",
      amount: input.money?.subtotal ?? null,
      note: "At the rates agreed for your company, at these quantities.",
      included: true,
    },
    {
      key: "freight",
      label: "Freight",
      amount: input.money?.freight ?? null,
      note: "Charged once for the whole basket, not per item.",
      included: true,
    },
  ]

  const taxStatus = String(input.tax?.status ?? "")
  if (input.tax?.total !== null && input.tax?.total !== undefined) {
    charges.push({
      key: "tax",
      label: "Tax",
      amount: input.tax.total,
      note: input.tax.inclusive
        ? "Already inside the prices shown."
        : "Added to the total shown.",
      included: true,
    })
  } else if (taxStatus) {
    charges.push({
      key: "tax",
      label: "Tax",
      amount: null,
      // 🔑 An unresolved tax is stated as unresolved. A silent zero would read
      // as "no tax due", which is a claim nobody made.
      note:
        taxStatus === "zero_rated"
          ? "Zero-rated on this lane."
          : "Confirmed when the order is placed.",
      included: false,
    })
  }

  const prepaid = Boolean(input.duty?.prepaid)
  if (input.cross_border) {
    charges.push({
      key: "duty",
      label: "Import duty and tax",
      amount: prepaid
        ? [input.duty?.total, input.duty?.import_tax, input.duty?.carrier_fee]
            .map((v) => Number(v ?? 0))
            .reduce((a, b) => a + b, 0) || null
        : null,
      note: prepaid
        ? "We pay these on your behalf. Nothing is collected on delivery."
        : // 🔴 The honest version. Duty, import VAT and the carrier's fee for
          // advancing them run to roughly a third of goods value on a real EU
          // lane, and the buyer meets them at the door.
          "Payable by you on arrival, at your country's rates. Ask us to quote this prepaid if you would rather it were settled here.",
      included: prepaid,
    })
  }

  charges.push({
    key: "platform",
    label: "Platform fee",
    amount: null,
    note: "None. What the maker charges is what you are quoted — we are paid by them, not by you.",
    included: true,
  })

  return {
    maker_name: makerName,
    verified,
    points,
    charges,
    currency_code: input.currency_code,
    // Only when there is genuinely nothing left to pay.
    no_further_charges: !input.cross_border || prepaid,
  }
}

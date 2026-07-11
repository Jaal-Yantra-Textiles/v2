import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { INVESTOR_MODULE } from "../../../../../modules/investor"
import type InvestorService from "../../../../../modules/investor/service"
import { convertConvertibleSchema } from "../../../../investors/validators"
import { computeConversion } from "../../../../../modules/investor/lib/convertible-conversion"

// POST /admin/convertibles/:id/convert — execute the conversion of an
// outstanding convertible (SAFE / note / loan) into real equity.
//
//  - target=equity → mints a Stake (shares) against the chosen share class and
//    records converted_stake_id on the convertible.
//  - target=ccps   → mints a NEW convertible tagged `ccps` with the computed
//    share count + preference terms (e.g. a 2-year-old loan becoming CCPS). The
//    original is marked converted and linked via metadata.converted_to.
//
// Conversion price/shares are derived from the cap/discount vs the priced round
// (see computeConversion). Idempotent-guarded: only `outstanding` can convert.
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = convertConvertibleSchema.parse(req.body ?? {})
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)

  const { data } = await query.graph({
    entity: "convertible",
    filters: { id: req.params.id },
    fields: [
      "*",
      "cap_table.id",
      "cap_table.fully_diluted_shares",
      "cap_table.currency_code",
    ],
  })
  const convertible = data?.[0] as any
  if (!convertible) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Convertible not found")
  }
  if (convertible.status !== "outstanding") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Only an outstanding instrument can be converted (this one is ${convertible.status})`
    )
  }

  const conversion = computeConversion(convertible, {
    round_price_per_share: body.round_price_per_share,
    fully_diluted_shares:
      body.fully_diluted_shares ?? convertible.cap_table?.fully_diluted_shares,
    shares: body.shares,
    price_per_share: body.price_per_share,
  })
  if (conversion.conversion_shares == null || conversion.conversion_shares <= 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Cannot derive a share count — supply a round price per share (and fully-diluted shares) or an explicit share count."
    )
  }

  const when = body.conversion_date ? new Date(body.conversion_date) : new Date()
  const currency =
    convertible.currency_code || convertible.cap_table?.currency_code || null
  const principal = Number(convertible.principal_amount ?? 0)

  if (body.target === "ccps") {
    // Loan/SAFE → CCPS: issue preference shares now (a new ccps convertible),
    // carrying the computed share count + preference terms.
    const ccps: any = await service.createConvertibles({
      investor_id: convertible.investor_id,
      cap_table_id: convertible.cap_table_id,
      funding_round_id: body.funding_round_id ?? null,
      instrument_type: "ccps",
      principal_amount: principal,
      currency_code: currency,
      valuation_cap: convertible.valuation_cap ?? null,
      discount_rate: convertible.discount_rate ?? null,
      safe_type: convertible.safe_type ?? "post_money",
      num_shares: conversion.conversion_shares,
      liquidation_preference_multiple: body.liquidation_preference_multiple ?? 1,
      dividend_rate: body.dividend_rate ?? null,
      conversion_ratio: body.conversion_ratio ?? 1,
      investment_date: convertible.investment_date ?? when,
      status: "outstanding",
      notes: `Converted from ${convertible.instrument_type} ${convertible.id}`,
      metadata: { converted_from: convertible.id },
    } as any)

    await service.updateConvertibles({
      id: convertible.id,
      status: "converted",
      conversion_date: when,
      conversion_shares: conversion.conversion_shares,
      conversion_price_per_share: conversion.conversion_price_per_share,
      metadata: {
        ...(convertible.metadata || {}),
        converted_to: ccps.id,
        conversion_target: "ccps",
        conversion_basis: conversion.basis,
      },
    } as any)

    return res.status(201).json({ target: "ccps", convertible: ccps, conversion })
  }

  // SAFE / note / loan → priced equity: mint a Stake.
  const stake: any = await service.createStakes({
    investor_id: convertible.investor_id,
    cap_table_id: convertible.cap_table_id,
    share_class_id: body.share_class_id ?? null,
    funding_round_id: body.funding_round_id ?? null,
    number_of_shares: conversion.conversion_shares,
    share_price: conversion.conversion_price_per_share,
    total_invested: principal,
    issue_date: when,
    status: "active",
    metadata: { converted_from: convertible.id },
  } as any)

  await service.updateConvertibles({
    id: convertible.id,
    status: "converted",
    converted_stake_id: stake.id,
    conversion_date: when,
    conversion_shares: conversion.conversion_shares,
    conversion_price_per_share: conversion.conversion_price_per_share,
    metadata: {
      ...(convertible.metadata || {}),
      conversion_target: "equity",
      conversion_basis: conversion.basis,
    },
  } as any)

  res.status(201).json({ target: "equity", stake, conversion })
}

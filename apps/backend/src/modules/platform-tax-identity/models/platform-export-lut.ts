import { model } from "@medusajs/framework/utils"

import PlatformTaxIdentity from "./platform-tax-identity"

/**
 * Export LUT — a Letter of Undertaking (GST form RFD-11) furnished by one of the
 * platform's tax identities (#1216).
 *
 * An export of goods is zero-rated either way; an LUT decides HOW the exporter
 * discharges that. With one on file no IGST is paid on the export (Shiprocket
 * `igstPaymentStatus: "B"`); without one, IGST is paid and reclaimed as a refund
 * ("C"). Declaring "B" with no LUT on file is a false declaration, so the
 * resolver fails toward "C" — see `resolveExportIgstStatus`.
 *
 * ONE ROW PER FINANCIAL YEAR, not a mutable flag. An LUT is valid for a single FY
 * and must be re-furnished each April, so renewal is an INSERT and the history
 * stays intact — which is the only way to answer "which regime was this shipment
 * declared under?" later. `valid_to` is what makes an expired LUT stop counting
 * instead of silently continuing to claim the exemption.
 *
 * This lives beside `platform_tax_identity` rather than in a carrier module
 * because an LUT is a fact about the exporting entity's GST registration, not
 * about Shiprocket — the same reason destination classification was lifted out of
 * the Shiprocket client. Any export channel reads the same row.
 */
const PlatformExportLut = model.define("platform_export_lut", {
  id: model.id().primaryKey(),
  /** ARN issued by the GST portal on furnishing RFD-11. */
  arn: model.text(),
  /** Financial year the LUT covers, as filed — e.g. "2026-27". */
  financial_year: model.text(),
  /** First day of cover (FY start, or the filing date for a mid-year LUT). */
  valid_from: model.dateTime(),
  /** Last day of cover — 31 March of the FY. Past this, the resolver returns "C". */
  valid_to: model.dateTime(),
  /** When RFD-11 was actually furnished, if it differs from `valid_from`. */
  filed_on: model.dateTime().nullable(),
  /** Free-text note (e.g. who filed it, witness details, portal reference). */
  notes: model.text().nullable(),
  /**
   * Withdrawn / superseded rows are skipped by the resolver without being
   * deleted — an LUT that was relied on for past shipments must stay readable.
   */
  is_active: model.boolean().default(true),
  /** The registration that furnished it (the Indian GSTIN, in practice). */
  tax_identity: model.belongsTo(() => PlatformTaxIdentity, {
    mappedBy: "export_luts",
  }),
})

export default PlatformExportLut

import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

import { PLATFORM_TAX_IDENTITY_MODULE } from "../../modules/platform-tax-identity"
import {
  resolveActiveExportLut,
  resolvePlatformTaxIdentity,
  type PlatformExportLutRow,
  type PlatformTaxIdentityRow,
} from "../../modules/platform-tax-identity/resolve-lib"
import { resolveVariantHsCode } from "../../modules/shipping-providers/hs-code-resolution"
import { resolveBrandStore } from "../../workflows/consumption-logs/lib/apply-to-inventory"
import type {
  OrderTaxInvoiceInput,
  TaxInvoiceParty,
} from "./order-tax-invoice-model"

/**
 * Read everything a tax invoice for `orderId` needs (#2532).
 *
 * Seller: the platform's India tax identity (legal name, GSTIN) at our brand
 * store's default stock location (Dharamshala) — decided 2026-11-09. Only
 * orders on the brand store's channel are invoiced; a partner store's order is
 * refused until we decide whose bill that is.
 */
export async function gatherOrderTaxInvoice(
  container: MedusaContainer,
  orderId: string,
  opts: { invoice_number: string | null; invoice_date: string; buyer_gstin?: string | null }
): Promise<OrderTaxInvoiceInput> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "display_id",
      "status",
      "created_at",
      "currency_code",
      "sales_channel_id",
      "total",
      "summary",
      "items.title",
      "items.variant_title",
      "items.variant_sku",
      "items.quantity",
      "items.total",
      "items.tax_total",
      "items.tax_lines.rate",
      "items.variant.hs_code",
      "items.variant.inventory_items.inventory.hs_code",
      "items.variant.product.hs_code",
      "shipping_methods.name",
      "shipping_methods.total",
      "shipping_methods.tax_total",
      "shipping_methods.tax_lines.rate",
      "shipping_address.*",
      "billing_address.*",
    ],
    filters: { id: orderId },
  })
  const order = (orders ?? [])[0]
  if (!order) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order ${orderId} not found`)
  }
  if (order.status === "canceled" || order.status === "draft") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Order ${order.display_id ?? orderId} is ${order.status}; a tax invoice is issued only for a real sale.`
    )
  }

  const brand = await resolveBrandStore(container)
  if (!brand.default_sales_channel_id || order.sales_channel_id !== brand.default_sales_channel_id) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Order ${order.display_id ?? orderId} was placed on a partner's store. Tax invoices are issued only for our own store's orders for now.`
    )
  }

  const { data: identities } = await query.graph({
    entity: PLATFORM_TAX_IDENTITY_MODULE,
    fields: [
      "id",
      "brand_code",
      "legal_name",
      "tax_id",
      "tax_id_type",
      "country_codes",
      "is_active",
    ],
  })
  const identity = resolvePlatformTaxIdentity(
    "in",
    (identities ?? []) as PlatformTaxIdentityRow[]
  )
  if (!identity?.tax_id || !identity.legal_name) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "No active India tax identity (legal name + GSTIN) — cannot issue a GST invoice."
    )
  }

  // Seller address = the stock location the order's sales channel sells from.
  const { data: channels } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "stock_locations.id", "stock_locations.name", "stock_locations.address.*"],
    filters: { id: order.sales_channel_id },
  })
  const picked = pickSellerLocation(
    ((channels ?? [])[0]?.stock_locations ?? []) as any[],
    brand.default_location_id
  )
  if ("error" in picked) {
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, picked.error)
  }
  const loc = picked.location
  const seller: TaxInvoiceParty = {
    name: identity.legal_name,
    lines: addressLines(loc?.address),
    state: loc?.address?.province ?? null,
    postal_code: loc?.address?.postal_code ?? null,
    country_code: loc?.address?.country_code ?? "in",
  }

  let exportLutArn: string | null = null
  try {
    const { data: luts } = await query.graph({
      entity: "platform_export_lut",
      fields: ["id", "arn", "financial_year", "valid_from", "valid_to", "is_active"],
    })
    exportLutArn =
      resolveActiveExportLut((luts ?? []) as PlatformExportLutRow[])?.arn ?? null
  } catch {
    exportLutArn = null
  }

  const rateOf = (taxLines: any[] | null | undefined) =>
    (taxLines ?? []).reduce((acc, t) => acc + Number(t?.rate ?? 0), 0)

  return {
    invoice_number: opts.invoice_number,
    invoice_date: opts.invoice_date,
    order: {
      id: order.id,
      display_id: order.display_id ?? null,
      created_at: order.created_at ? new Date(order.created_at).toISOString() : null,
      currency_code: order.currency_code,
      total: Number(order.total ?? 0),
      paid_total: Number(order.summary?.paid_total ?? 0),
    },
    seller: { legal_name: identity.legal_name, gstin: identity.tax_id, address: seller },
    bill_to: party(order.billing_address),
    ship_to: party(order.shipping_address),
    buyer_gstin: opts.buyer_gstin ?? null,
    lines: ((order.items ?? []) as any[]).map((i) => ({
      title: i.title,
      variant_title: i.variant_title ?? null,
      sku: i.variant_sku ?? null,
      hs_code: resolveVariantHsCode(i.variant).hs_code ?? null,
      quantity: Number(i.quantity ?? 0),
      total: Number(i.total ?? 0),
      tax_total: Number(i.tax_total ?? 0),
      tax_rate: rateOf(i.tax_lines),
    })),
    charges: ((order.shipping_methods ?? []) as any[]).map((s) => ({
      name: s.name ?? "Shipping",
      total: Number(s.total ?? 0),
      tax_total: Number(s.tax_total ?? 0),
      tax_rate: rateOf(s.tax_lines),
    })),
    export_lut_arn: exportLutArn,
  }
}

const addressLines = (a: any): string[] => {
  if (!a) return []
  const cityLine = [a.city, [a.province, a.postal_code].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ")
  return [
    a.company,
    a.address_1,
    a.address_2,
    cityLine,
    a.country_code ? String(a.country_code).toUpperCase() : null,
    a.phone ? `Phone: ${a.phone}` : null,
  ].filter((l): l is string => !!l && String(l).trim().length > 0)
}

/** null when the address has nothing printable — a bare `{country_code}`. */
const party = (a: any): TaxInvoiceParty | null => {
  if (!a) return null
  const name = [a.first_name, a.last_name].filter(Boolean).join(" ").trim()
  const lines = addressLines(a)
  const hasAddress = !!(a.address_1 || a.city || a.postal_code || a.province)
  if (!name && !hasAddress) {
    return a.country_code
      ? { name: "", lines: [], country_code: a.country_code }
      : null
  }
  return {
    name: name || a.company || "Customer",
    lines,
    state: a.province ?? null,
    postal_code: a.postal_code ?? null,
    country_code: a.country_code ?? null,
  }
}

/**
 * PURE: which of the sales channel's stock locations is the seller address.
 * One location → that one. Several → the store's default location if it is
 * among them; otherwise refuse rather than print a guessed address on a tax
 * invoice.
 */
export function pickSellerLocation(
  locations: Array<{ id?: string | null; name?: string | null; address?: any } | null>,
  storeDefaultLocationId: string | null
): { location: { id: string; address?: any } } | { error: string } {
  const usable = locations.filter((l): l is { id: string; name?: string | null; address?: any } => !!l?.id)
  if (usable.length === 1) return { location: usable[0] }
  if (!usable.length) {
    return { error: "The order's sales channel has no stock location to use as the seller address." }
  }
  const preferred = usable.find((l) => l.id === storeDefaultLocationId)
  if (preferred) return { location: preferred }
  return {
    error: `The order's sales channel sells from ${usable.length} locations (${usable
      .map((l) => l.name ?? l.id)
      .join(", ")}) and none is the store's default. Not guessing the seller address.`,
  }
}

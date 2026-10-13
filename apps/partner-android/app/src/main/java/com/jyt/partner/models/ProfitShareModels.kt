package com.jyt.partner.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

// Profit share on a run made with our material (#2322 / #2401).
// GET  /partners/production-runs/:id/profit-share
// POST /partners/production-runs/:id/profit-share/sales
//
// Every amount is a bigNumber column, so it may arrive as a JSON number OR a
// numeric string — all of them decode through FlexibleDouble.

@Serializable
data class ProfitShareResponse(
    @SerialName("profit_share") val profitShare: ProfitShare,
)

@Serializable
data class RecordSaleResponse(
    val sale: ProfitShareSale? = null,
    @SerialName("profit_share") val profitShare: ProfitShare,
)

@Serializable
data class ProfitShare(
    @SerialName("production_run_id") val productionRunId: String? = null,
    @SerialName("partner_id") val partnerId: String? = null,
    val percent: FlexibleDouble? = null,
    val sales: List<ProfitShareSale> = emptyList(),
    val settlements: List<ProfitShareSettlement> = emptyList(),
    val summary: ProfitShareSummary? = null,
) {
    /** A deal exists only when a percent is set. No percent: hide the
     *  profit share entirely, never show ₹0. */
    val hasDeal: Boolean get() = percent?.value != null
}

@Serializable
data class ProfitShareSale(
    val id: String,
    val quantity: FlexibleDouble? = null,
    @SerialName("unit_price") val unitPrice: FlexibleDouble? = null,
    @SerialName("currency_code") val currencyCode: String? = null,
    @SerialName("sold_at") val soldAt: String? = null,
    val note: String? = null,
    /** "admin" or "partner". */
    @SerialName("reported_by") val reportedBy: String? = null,
) {
    val lineTotal: Double?
        get() {
            val q = quantity?.value ?: return null
            val p = unitPrice?.value ?: return null
            return Math.round(q * p * 100) / 100.0
        }
}

@Serializable
data class ProfitShareSettlement(
    val id: String,
    val amount: FlexibleDouble? = null,
    @SerialName("currency_code") val currencyCode: String? = null,
    @SerialName("paid_at") val paidAt: String? = null,
    val reference: String? = null,
    @SerialName("receipt_url") val receiptUrl: String? = null,
    val note: String? = null,
)

@Serializable
data class ProfitShareSummary(
    val percent: FlexibleDouble? = null,
    @SerialName("currency_code") val currencyCode: String? = null,
    @SerialName("run_quantity") val runQuantity: FlexibleDouble? = null,
    @SerialName("sold_quantity") val soldQuantity: FlexibleDouble? = null,
    @SerialName("unsold_quantity") val unsoldQuantity: FlexibleDouble? = null,
    @SerialName("gross_sales") val grossSales: FlexibleDouble? = null,
    /** null means there is no deal — never render it as 0. */
    val owed: FlexibleDouble? = null,
    val paid: FlexibleDouble? = null,
    val balance: FlexibleDouble? = null,
    /** none | no_sales | open | settled | overpaid */
    val status: String? = null,
    /** Rows in more than one currency: the server refuses to add them up. */
    @SerialName("currency_mismatch") val currencyMismatch: Boolean = false,
    val working: List<String> = emptyList(),
)

@Serializable
data class RecordSaleBody(
    val quantity: Double,
    @SerialName("unit_price") val unitPrice: Double,
    @SerialName("currency_code") val currencyCode: String? = null,
    /** ISO-8601 with an offset — the route's zod takes `datetime({ offset: true })`. */
    @SerialName("sold_at") val soldAt: String? = null,
    val note: String? = null,
)

/** Plain words for the summary status. */
fun profitShareStatusLabel(status: String?): String = when (status) {
    "none" -> "No deal"
    "no_sales" -> "No sales yet"
    "open" -> "Open"
    "settled" -> "Settled"
    "overpaid" -> "Overpaid"
    null, "" -> "—"
    else -> status.replace('_', ' ').replaceFirstChar { it.uppercase() }
}

/** Who reported a sale, from the partner's point of view. */
fun profitShareReporterLabel(reportedBy: String?): String = when (reportedBy) {
    "admin" -> "JYT"
    "partner" -> "You"
    else -> "—"
}

private val SOLD_AT_FORMAT: DateTimeFormatter =
    DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US)

/**
 * The `sold_at` sent for a sale on [date]: today keeps the current time,
 * another day is stamped at noon so a timezone shift can't move it a day.
 * Always whole seconds and an explicit offset ("2026-10-13T12:00:00+05:30"),
 * which the route's zod `datetime({ offset: true })` takes.
 */
fun soldAtIso(
    date: LocalDate,
    zone: ZoneId = ZoneId.systemDefault(),
    now: ZonedDateTime = ZonedDateTime.now(zone),
): String {
    val stamp = if (date == now.toLocalDate()) {
        now.withNano(0)
    } else {
        ZonedDateTime.of(date, LocalTime.NOON, zone)
    }
    return stamp.format(SOLD_AT_FORMAT)
}

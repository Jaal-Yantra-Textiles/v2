package com.jyt.partner.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// The partner API contract for design orders — the Kotlin mirror of the iOS
// app's Models.swift and the backend `/partners/orders?kind=design` surface.
// Dates stay raw strings in the models and parse through [parseApiDate],
// which handles both ISO-8601 and the JS `Date.toString()` format some
// design routes emit.

@Serializable
data class OrderDesignSummary(
    val id: String,
    val name: String? = null,
    val thumbnail: String? = null,
)

@Serializable
enum class WorkStatus(val label: String) {
    @SerialName("assigned") ASSIGNED("Assigned"),
    @SerialName("accepted") ACCEPTED("Accepted"),
    @SerialName("in_progress") IN_PROGRESS("In Progress"),
    @SerialName("partial") PARTIAL("Partial"),
    @SerialName("finished") FINISHED("Finished"),
    @SerialName("completed") COMPLETED("Completed"),
    @SerialName("declined") DECLINED("Declined"),
    @SerialName("cancelled") CANCELLED("Cancelled");

    companion object {
        fun from(raw: String?): WorkStatus? =
            raw?.let { entries.firstOrNull { e -> e.name.equals(it, ignoreCase = true) } }
    }
}

@Serializable
data class UnifiedOrderStatus(
    @SerialName("partner_status") val partnerStatus: String? = null,
)

@Serializable
data class PartnerOrder(
    val id: String,
    @SerialName("display_id") val displayId: Int,
    val status: String = "",
    @SerialName("payment_status") val paymentStatus: String? = null,
    @SerialName("fulfillment_status") val fulfillmentStatus: String? = null,
    val email: String? = null,
    val total: Double = 0.0,
    @SerialName("currency_code") val currencyCode: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    /** Present on LIST rows, absent on the detail read. */
    val designs: List<OrderDesignSummary>? = null,
    /** Line items (present on the detail read). */
    val items: List<PartnerOrderItem>? = null,
    /** Run refs attached by the detail read — the matching production runs. */
    @SerialName("production_runs") val productionRuns: List<ProductionRunRef>? = null,
    @SerialName("unified_order_status") val unifiedOrderStatus: UnifiedOrderStatus? = null,
) {
    val workStatus: WorkStatus?
        get() = WorkStatus.from(unifiedOrderStatus?.partnerStatus)
}

@Serializable
data class ProductionRunRef(val id: String)

@Serializable
data class PartnerOrderItem(
    val id: String,
    val title: String? = null,
    val subtitle: String? = null,
    val thumbnail: String? = null,
    val quantity: Int = 0,
    val total: Double = 0.0,
)

@Serializable
data class PartnerOrderListResponse(
    val orders: List<PartnerOrder>,
    val count: Int,
    val offset: Int,
    val limit: Int,
)

@Serializable
data class PartnerOrderDetailResponse(val order: PartnerOrder)

@Serializable
data class PartnerMe(
    val admin: Admin? = null,
    @SerialName("partner_id") val partnerId: String? = null,
) {
    @Serializable
    data class Admin(
        val id: String = "",
        val email: String = "",
        @SerialName("first_name") val firstName: String? = null,
        @SerialName("last_name") val lastName: String? = null,
        val role: String? = null,
    )

    /** "E2E Partner" from first/last name, falling back to the email. */
    val displayName: String
        get() {
            val joined = listOfNotNull(admin?.firstName, admin?.lastName)
                .joinToString(" ")
                .trim()
            return joined.ifEmpty { admin?.email ?: "Partner" }
        }
}

/** A wrapper carrying the caller-facing failure — the Swift PartnerError. */
sealed class PartnerException(message: String) : Exception(message) {
    object InvalidResponse : PartnerException("The server sent an unexpected response.")
    class Decoding(detail: String) : PartnerException("The server sent an unexpected response ($detail).")
    class Http(val status: Int, message: String) : PartnerException(
        if (status == 401) "Invalid email or password."
        else message.ifEmpty { "Request failed (HTTP $status)." }
    )
}

object ApiDate {
    private val iso by lazy {
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US).apply {
            isLenient = true
        }
    }
    private val isoNoMillis by lazy {
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US).apply {
            isLenient = true
        }
    }

    /** JS `Date.toString()` — "Wed Sep 23 2026 09:18:09 GMT+1000 (AEST)" —
     *  parsed on its own terms after stripping the trailing zone name. */
    private val js by lazy {
        SimpleDateFormat("EEE MMM dd yyyy HH:mm:ss 'GMT'Z", Locale.US)
    }

    /** Parse without throwing: each format is tried in turn and a mismatch
     *  falls through to the next (the throwing `parse(String)` crashed on
     *  the first mismatch, so an ISO date without millis — or a JS-format
     *  date — took the whole composable down instead of rendering "—"). */
    fun parse(raw: String?): Date? {
        if (raw.isNullOrBlank()) return null
        val pos = java.text.ParsePosition(0)
        iso.parse(raw, pos)?.let { return it }
        pos.index = 0
        isoNoMillis.parse(raw, pos)?.let { return it }
        val candidate = raw.substringBefore(" (")
        pos.index = 0
        return js.parse(candidate, pos)
    }
}

fun formatDate(date: Date?): String {
    if (date == null) return "—"
    return SimpleDateFormat("MMM d, yyyy", Locale.US).format(date)
}

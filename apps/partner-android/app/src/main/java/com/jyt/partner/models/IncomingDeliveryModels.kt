package com.jyt.partner.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// #2286 — the receiving partner's side of inventory orders: goods delivered
// TO this partner's warehouse, whoever supplies them. Deliberately no
// prices — lines carry what was ordered, received so far, and still owed.
// Shapes mirror apps/backend/src/api/partners/lib/incoming-deliveries.ts.

@Serializable
data class IncomingDeliveryLine(
    val id: String,
    val name: String? = null,
    val unit: String? = null,
    val ordered: Double = 0.0,
    val received: Double = 0.0,
    val outstanding: Double = 0.0,
)

@Serializable
data class IncomingDelivery(
    val id: String,
    val status: String = "",
    @SerialName("order_date") val orderDate: String? = null,
    @SerialName("expected_delivery_date") val expectedDeliveryDate: String? = null,
    @SerialName("is_sample") val isSample: Boolean? = null,
    /** The supplier's warehouse name — the only "who sends this" there is. */
    val from: String? = null,
    @SerialName("invoice_number") val invoiceNumber: String? = null,
    val lines: List<IncomingDeliveryLine> = emptyList(),
    val outstanding: Double = 0.0,
    @SerialName("fully_received") val fullyReceived: Boolean? = null,
    @SerialName("can_confirm") val canConfirm: Boolean? = null,
    /** "not_dispatched" | "fully_received" | null — the backend's reason,
     *  in the partner's terms, why Confirm is not offered. */
    @SerialName("cannot_confirm_reason") val cannotConfirmReason: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
) {
    val statusEnum: InventoryOrderStatus? get() = InventoryOrderStatus.from(status)
}

@Serializable
data class IncomingDeliveriesResponse(
    @SerialName("incoming_deliveries") val incomingDeliveries: List<IncomingDelivery>,
    val count: Int = 0,
    /** The partner's home warehouse — null means no warehouse is linked and
     *  nothing can ever be delivered to them. */
    @SerialName("location_id") val locationId: String? = null,
)

/** POST /partners/incoming-deliveries/:id/receive — what the partner states
 *  arrived. Quantity 0 is allowed ("this line brought nothing"); the array
 *  itself must be non-empty. No location field: goods land at the partner's
 *  own warehouse. */
@Serializable
data class ReceiveIncomingBody(
    val lines: List<Line>,
    val notes: String? = null,
) {
    @Serializable
    data class Line(
        @SerialName("order_line_id") val orderLineId: String,
        val quantity: Double,
    )
}

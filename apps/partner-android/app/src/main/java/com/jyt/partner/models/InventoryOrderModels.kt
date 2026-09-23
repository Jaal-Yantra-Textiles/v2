package com.jyt.partner.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// The inventory-order API contract — the Kotlin mirror of the iOS app's
// InventoryOrderModels.swift. The partner is the SUPPLIER here: they are
// commissioned to make/ship raw material (cloth, yarn, trim) and
// "complete" = record what was delivered, per line, with a delivery date
// and tracking number — the goods receipt the backend receives against stock.

@Serializable
enum class InventoryOrderStatus(val raw: String) {
    @SerialName("Pending") PENDING("Pending"),
    @SerialName("Processing") PROCESSING("Processing"),
    @SerialName("Ready for Delivery") READY_FOR_DELIVERY("Ready for Delivery"),
    @SerialName("Shipped") SHIPPED("Shipped"),
    @SerialName("Delivered") DELIVERED("Delivered"),
    @SerialName("Cancelled") CANCELLED("Cancelled"),
    @SerialName("Partial") PARTIAL("Partial");

    companion object {
        fun from(raw: String?): InventoryOrderStatus? =
            raw?.let { r -> entries.firstOrNull { it.raw == r } }
    }
}

@Serializable
data class RawMaterialSummary(
    val id: String? = null,
    val name: String? = null,
)

@Serializable
data class InventoryItemSummary(
    val id: String? = null,
    val sku: String? = null,
    val title: String? = null,
    @SerialName("raw_materials") val rawMaterials: List<RawMaterialSummary>? = null,
)

@Serializable
data class LineFulfillment(
    val id: String? = null,
    val quantity: Double? = null,
    val status: String? = null,
)

/** One order line — these goods are cloth, yarn and trim, so quantity is a
 *  REAL (metres/kilograms), not a count. */
@Serializable
data class InventoryOrderLine(
    val id: String,
    @SerialName("inventory_item_id") val inventoryItemId: String? = null,
    val quantity: Double = 0.0,
    val price: Double = 0.0,
    @SerialName("extra_cost") val extraCost: Double? = null,
    val metadata: Map<String, String>? = null,
    @SerialName("inventory_items") val inventoryItems: List<InventoryItemSummary>? = null,
    @SerialName("line_fulfillments") val lineFulfillments: List<LineFulfillment>? = null,
) {
    val displayName: String
        get() = inventoryItems?.firstOrNull()
            ?.rawMaterials?.firstOrNull()?.name
            ?: inventoryItems?.firstOrNull()?.sku
            ?: "Material"

    val fulfilled: Double
        get() = lineFulfillments.orEmpty().sumOf { it.quantity ?: 0.0 }

    val outstanding: Double get() = (quantity - fulfilled).coerceAtLeast(0.0)
}

@Serializable
data class InventoryOrderPartnerInfo(
    @SerialName("assigned_partner_id") val assignedPartnerId: String? = null,
    @SerialName("partner_name") val partnerName: String? = null,
    @SerialName("partner_status") val partnerStatus: String? = null,
    @SerialName("partner_started_at") val partnerStartedAt: String? = null,
    @SerialName("partner_completed_at") val partnerCompletedAt: String? = null,
    @SerialName("delivery_date") val deliveryDate: String? = null,
    @SerialName("tracking_number") val trackingNumber: String? = null,
    @SerialName("admin_notes") val adminNotes: String? = null,
    @SerialName("workflow_tasks_count") val workflowTasksCount: Int? = null,
)

@Serializable
data class PartnerInventoryOrder(
    val id: String,
    val status: String = "",
    val quantity: Double? = null,
    @SerialName("total_price") val totalPrice: Double? = null,
    @SerialName("currency_code") val currencyCode: String? = null,
    @SerialName("expected_delivery_date") val expectedDeliveryDate: String? = null,
    @SerialName("order_date") val orderDate: String? = null,
    @SerialName("is_sample") val isSample: Boolean? = null,
    @SerialName("order_lines") val orderLines: List<InventoryOrderLine>? = null,
    @SerialName("partner_info") val partnerInfo: InventoryOrderPartnerInfo? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
) {
    val statusEnum: InventoryOrderStatus? get() = InventoryOrderStatus.from(status)

    /** What the partner still owes on this order, summed over lines. */
    val outstandingQuantity: Double
        get() = orderLines.orEmpty().sumOf { it.outstanding }
}

@Serializable
data class PartnerInventoryOrderListResponse(
    @SerialName("inventory_orders") val inventoryOrders: List<PartnerInventoryOrder>,
    val count: Int,
    val limit: Int,
    val offset: Int,
)

@Serializable
data class PartnerInventoryOrderDetailResponse(
    @SerialName("inventoryOrder") val inventoryOrder: PartnerInventoryOrder,
)

@Serializable
data class InventoryOrderChargesResponse(
    val charges: List<Charge>,
    val totals: Totals? = null,
    @SerialName("goods_total") val goodsTotal: Double? = null,
    @SerialName("payable_ceiling") val payableCeiling: Double? = null,
) {
    @Serializable
    data class Charge(
        val id: String,
        val type: String,
        val amount: Double,
        val note: String? = null,
        /** 1 raises, -1 lowers, 0 unknown. The backend's, never re-derived. */
        val direction: Int? = null,
    )

    @Serializable
    data class Totals(
        val raises: Double? = null,
        val lowers: Double? = null,
        val net: Double? = null,
    )
}

/** The complete (goods-receipt) payload — POST /partners/inventory-orders/:id/complete. */
@Serializable
data class CompleteInventoryOrderBody(
    val notes: String? = null,
    /** "yyyy-MM-dd" — the backend validator takes the date as a string. */
    @SerialName("deliveryDate") val deliveryDate: String? = null,
    @SerialName("trackingNumber") val trackingNumber: String? = null,
    val lines: List<Line>,
) {
    @Serializable
    data class Line(
        @SerialName("order_line_id") val orderLineId: String,
        val quantity: Double,
    )
}

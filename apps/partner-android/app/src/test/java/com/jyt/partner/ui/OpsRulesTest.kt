package com.jyt.partner.ui

import com.jyt.partner.models.InventoryOrderStatus
import com.jyt.partner.models.ShippingRate
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The rules behind the run-complete cost preview, the inventory order's
 *  next steps, and the courier list — plain functions, no Compose. */
class OpsRulesTest {

    // ── Cost preview: always against the ORDERED quantity ────────────────

    @Test
    fun `per piece multiplies by the ordered quantity`() {
        val preview = costPreview(45.0, CostType.PER_UNIT, orderedQuantity = 10.0)
        assertEquals(450.0, preview.total, 0.0)
        assertEquals(45.0, preview.perPiece, 0.0)
        assertEquals(10.0, preview.units, 0.0)
    }

    @Test
    fun `total divides by the ordered quantity, rounded to paise`() {
        val preview = costPreview(1000.0, CostType.TOTAL, orderedQuantity = 3.0)
        assertEquals(1000.0, preview.total, 0.0)
        assertEquals(333.33, preview.perPiece, 0.0)
    }

    @Test
    fun `no ordered quantity counts as one piece`() {
        assertEquals(45.0, costPreview(45.0, CostType.PER_UNIT, orderedQuantity = 0.0).total, 0.0)
    }

    @Test
    fun `cost types are labelled per piece and total`() {
        assertEquals("per_unit", CostType.PER_UNIT.raw)
        assertEquals("Per piece", CostType.PER_UNIT.label)
        assertEquals("Total", CostType.TOTAL.label)
    }

    // ── Inventory order next steps ───────────────────────────────────────

    @Test
    fun `next steps follow the backend's status gates`() {
        assertEquals(listOf(OrderStep.START), orderSteps(InventoryOrderStatus.PENDING))
        assertEquals(
            listOf(OrderStep.RECORD_DELIVERY, OrderStep.CREATE_SHIPMENT),
            orderSteps(InventoryOrderStatus.PROCESSING),
        )
        assertEquals(
            listOf(OrderStep.RECORD_DELIVERY, OrderStep.READY_FOR_DELIVERY, OrderStep.CREATE_SHIPMENT),
            orderSteps(InventoryOrderStatus.PARTIAL),
        )
        assertEquals(listOf(OrderStep.CREATE_SHIPMENT), orderSteps(InventoryOrderStatus.READY_FOR_DELIVERY))
        assertEquals(listOf(OrderStep.CREATE_SHIPMENT), orderSteps(InventoryOrderStatus.SHIPPED))
        assertTrue(orderSteps(InventoryOrderStatus.DELIVERED).isEmpty())
        assertTrue(orderSteps(InventoryOrderStatus.CANCELLED).isEmpty())
        assertTrue(orderSteps(null).isEmpty())
    }

    @Test
    fun `ready for delivery is offered only on a partial order`() {
        InventoryOrderStatus.entries.forEach { status ->
            assertEquals(
                status.name,
                status == InventoryOrderStatus.PARTIAL,
                OrderStep.READY_FOR_DELIVERY in orderSteps(status),
            )
        }
    }

    // ── Courier list ─────────────────────────────────────────────────────

    private fun rate(id: Any, amount: Double, recommended: Boolean? = null) = ShippingRate(
        courierIdRaw = if (id is Number) JsonPrimitive(id) else JsonPrimitive(id.toString()),
        courierName = "c$id",
        amount = amount,
        isRecommended = recommended,
    )

    @Test
    fun `couriers list cheapest first and the recommended one is preselected`() {
        val rates = listOf(rate(1, 200.0), rate(2, 90.0), rate("3", 150.0, recommended = true))
        assertEquals(listOf("2", "3", "1"), sortRates(rates).map { it.courierId })
        assertEquals("3", preselectedCourier(rates))
    }

    @Test
    fun `without a recommendation the cheapest is preselected`() {
        assertEquals("2", preselectedCourier(listOf(rate(1, 200.0), rate(2, 90.0))))
    }

    @Test
    fun `pickup dates format readably and leave odd text alone`() {
        assertEquals("Oct 5, 2026", formatYmd("2026-10-05"))
        assertEquals("Oct 5, 2026", formatYmd("2026-10-05T00:00:00.000Z"))
        assertEquals("soon", formatYmd("soon"))
    }
}

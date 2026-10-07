package com.jyt.partner.models

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class OrderFilterTest {
    private fun order(id: String, status: String?) = PartnerOrder(
        id = id,
        displayId = id.hashCode(),
        unifiedOrderStatus = status?.let { UnifiedOrderStatus(partnerStatus = it) },
    )

    private val orders = listOf(
        order("a", "assigned"),
        order("b", "accepted"),
        order("c", "in_progress"),
        order("d", "partial"),
        order("e", "finished"),
        order("f", "completed"),
        order("g", "declined"),
        order("h", "cancelled"),
        order("i", null),
    )

    @Test
    fun `each status lands in exactly one filter besides All`() {
        val groups = OrderFilter.entries - OrderFilter.ALL
        orders.forEach { o ->
            assertEquals(o.id, 1, groups.count { it.matches(o.workStatus) })
        }
    }

    @Test
    fun `ongoing is the work in hand`() {
        assertEquals(
            listOf("b", "c", "d"),
            orders.filter { OrderFilter.ONGOING.matches(it.workStatus) }.map { it.id },
        )
    }

    @Test
    fun `counts add up to All`() {
        val counts = OrderFilter.counts(orders)
        assertEquals(9, counts[OrderFilter.ALL])
        assertEquals(mapOf(OrderFilter.ONGOING to 3, OrderFilter.NEW to 2, OrderFilter.DONE to 2, OrderFilter.CLOSED to 2),
            counts - OrderFilter.ALL)
        assertTrue(OrderFilter.NEW.matches(null))
    }
}

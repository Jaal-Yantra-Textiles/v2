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
    fun `All hides cancelled work, Closed is where it is asked for`() {
        val all = orders.filter { OrderFilter.ALL.matches(it.workStatus) }.map { it.id }
        assertEquals(listOf("a", "b", "c", "d", "e", "f", "g", "i"), all)
        assertTrue(OrderFilter.CLOSED.matches(WorkStatus.CANCELLED))
    }

    @Test
    fun `counts add up to All plus the hidden cancelled`() {
        val counts = OrderFilter.counts(orders)
        // 9 orders, one cancelled: All shows 8, Closed still counts it.
        assertEquals(8, counts[OrderFilter.ALL])
        assertEquals(mapOf(OrderFilter.ONGOING to 3, OrderFilter.NEW to 2, OrderFilter.DONE to 2, OrderFilter.CLOSED to 2),
            counts - OrderFilter.ALL)
        assertTrue(OrderFilter.NEW.matches(null))
    }
}

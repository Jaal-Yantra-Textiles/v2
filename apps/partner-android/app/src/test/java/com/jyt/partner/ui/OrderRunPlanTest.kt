package com.jyt.partner.ui

import com.jyt.partner.models.DesignDetail
import com.jyt.partner.models.OrderDesignSummary
import com.jyt.partner.models.PartnerInfo
import com.jyt.partner.models.PartnerOrder
import com.jyt.partner.models.ProductionRun
import com.jyt.partner.models.UnifiedOrderKind
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class OrderRunPlanTest {
    private fun run(id: String, status: String, started: Boolean = false, finished: Boolean = false) =
        ProductionRun(
            id = id,
            status = status,
            startedAt = if (started) "2026-10-01T00:00:00Z" else null,
            finishedAt = if (finished) "2026-10-02T00:00:00Z" else null,
        )

    @Test
    fun `each design's run is offered under the action it owes`() {
        val runs = listOf(
            run("a", "sent_to_partner"),
            run("b", "sent_to_partner"),
            run("c", "in_progress"),
            run("d", "in_progress", started = true),
            run("e", "in_progress", started = true, finished = true),
            run("f", "completed"),
            run("g", "cancelled"),
        )
        val plan = bulkActions(runs).associate { (action, targets) -> action to targets.map { it.id } }
        assertEquals(
            mapOf(
                RunAction.ACCEPT to listOf("a", "b"),
                RunAction.START to listOf("c"),
                RunAction.FINISH to listOf("d"),
                RunAction.COMPLETE to listOf("e"),
            ),
            plan,
        )
    }

    @Test
    fun `nothing owed means no all-designs actions`() {
        assertTrue(bulkActions(listOf(run("f", "completed"), run("g", "cancelled"))).isEmpty())
    }

    @Test
    fun `one run keeps the single-design screen`() {
        assertFalse(isMultiRun(listOf(run("a", "sent_to_partner"))))
        assertTrue(isMultiRun(listOf(run("a", "sent_to_partner"), run("b", "completed"))))
    }

    private fun bundle(designs: Int) = PartnerOrder(
        id = "order_1",
        displayId = 152,
        designs = (1..designs).map { OrderDesignSummary(id = "des_$it") },
        unifiedOrderKind = UnifiedOrderKind("collated"),
    )

    @Test
    fun `a bundle gets the design cards even with one run loaded`() {
        val one = listOf(run("a", "sent_to_partner"))
        assertTrue(usesDesignCards(bundle(9), one))
        assertFalse(usesDesignCards(PartnerOrder(id = "o", displayId = 1), one))
        assertFalse(usesDesignCards(null, one))
    }

    @Test
    fun `the list row names a bundle and its design count`() {
        assertEquals("Bundle · 9 designs", bundleLabel(bundle(9)))
        assertEquals("Bundle · 1 design", bundleLabel(bundle(1)))
        assertEquals("Bundle", bundleLabel(bundle(0)))
        assertNull(bundleLabel(PartnerOrder(id = "o", displayId = 1)))
    }

    @Test
    fun `a design whose assignment was cancelled offers nothing`() {
        val cancelled = DesignDetail(id = "d", partnerInfo = PartnerInfo(partnerStatus = "cancelled"))
        val live = DesignDetail(id = "d", partnerInfo = PartnerInfo(partnerStatus = "in_progress"))
        assertFalse(isActionable(cancelled))
        assertTrue(isActionable(live))
        assertTrue(isActionable(null))

        val runs = listOf(run("a", "sent_to_partner"), run("b", "sent_to_partner"))
        assertNull(nextRunAction(runs[0], actionable = false))
        val plan = bulkActions(runs) { it.id != "b" }
        assertEquals(listOf(RunAction.ACCEPT to listOf("a")), plan.map { (a, t) -> a to t.map { it.id } })
    }

    @Test
    fun `a failure on one design doesn't stop the rest`() = runBlocking {
        val seen = mutableListOf<String>()
        val result = runEach(listOf(run("a", "x"), run("b", "x"), run("c", "x"))) { r ->
            seen += r.id
            if (r.id == "b") error("Run is not in sent_to_partner")
        }
        assertEquals(listOf("a", "b", "c"), seen)
        assertEquals(listOf("a", "c"), result.done.map { it.id })
        assertEquals(
            "2 of 3 went through.\n\n• Design B: Run is not in sent_to_partner",
            result.failureMessage { "Design ${it.id.uppercase()}" },
        )
    }

    @Test
    fun `all through means no failure message`() = runBlocking {
        assertNull(runEach(listOf(run("a", "x"))) {}.failureMessage { it.id })
    }

    @Test
    fun `leaving the screen cancels the rest instead of counting as a failure`() = runBlocking {
        val seen = mutableListOf<String>()
        try {
            runEach(listOf(run("a", "x"), run("b", "x"))) { r ->
                seen += r.id
                throw CancellationException("left")
            }
            fail("cancellation must propagate")
        } catch (_: CancellationException) {
        }
        assertEquals(listOf("a"), seen)
    }
}

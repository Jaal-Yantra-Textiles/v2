package com.jyt.partner.models

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CompletionSplitTest {
    private val json = Json { ignoreUnknownKeys = true; coerceInputValues = true; explicitNulls = false }

    private fun run(body: String): ProductionRun =
        json.decodeFromString(ProductionRun.serializer(), """{"id":"r1",$body}""")

    private val twoSizes = run(
        """"quantity":3,"snapshot":{"design":{"name":"x"},"size_sets":[{"size_label":"M"},{"size_label":"L"}],"colors":[{"name":"Black"}]}"""
    )

    @Test
    fun `a run with several sizes needs a split, one row per combination`() {
        val axes = CompletionSplit.axes(twoSizes)
        assertEquals(listOf("M", "L"), axes.sizes)
        assertEquals(listOf("Black"), axes.colors)
        assertTrue(CompletionSplit.needed(axes))
        assertEquals(listOf("M · Black", "L · Black"), CompletionSplit.combos(axes).map { it.label })
    }

    @Test
    fun `a run with one size and one colour needs no split`() {
        val single = run(""""snapshot":{"size_sets":[{"size_label":"M"}],"colors":[{"name":"Black"}]}""")
        assertEquals(SplitPlan.NotNeeded, CompletionSplit.plan(CompletionSplit.axes(single), emptyMap(), 3.0))
    }

    @Test
    fun `the split must add up to the good pieces`() {
        val axes = CompletionSplit.axes(twoSizes)
        val m = SplitCombo("M", "Black").key
        val l = SplitCombo("L", "Black").key

        val short = CompletionSplit.plan(axes, mapOf(m to "1", l to "1"), 3.0) as SplitPlan.Needed
        assertFalse(short.ok)

        val exact = CompletionSplit.plan(axes, mapOf(m to "2", l to "1"), 3.0) as SplitPlan.Needed
        assertTrue(exact.ok)
        assertEquals(listOf(OutputLine("M", "Black", 2.0), OutputLine("L", "Black", 1.0)), exact.lines)
    }

    @Test
    fun `the plan pre-fills only when it adds up to the good pieces`() {
        val planned = run(
            """"snapshot":{"size_sets":[{"size_label":"M"},{"size_label":"L"}]},"planned_output":[{"size_label":"M","quantity":2},{"size_label":"L","quantity":1}]"""
        )
        val axes = CompletionSplit.axes(planned)
        assertEquals("2", CompletionSplit.initial(planned, axes, 3.0)[SplitCombo("M", null).key])
        assertEquals("", CompletionSplit.initial(planned, axes, 2.0)[SplitCombo("M", null).key])
    }

    @Test
    fun `an odd snapshot or plan does not stop the run decoding`() {
        val odd = run(""""snapshot":"not-an-object","planned_output":{"weird":true}""")
        assertEquals(SplitAxes(emptyList(), emptyList()), CompletionSplit.axes(odd))
        assertTrue(CompletionSplit.planned(odd).isEmpty())
    }

    @Test
    fun `an order's design comes from its line, then its runs, then the list summary`() {
        val fromLine = PartnerOrder(id = "o", displayId = 1, items = listOf(PartnerOrderItem(id = "i", designId = "d-line")))
        assertEquals("d-line", fromLine.resolveDesignId(listOf(ProductionRun(id = "r", designId = "d-run"))))

        val fromRun = PartnerOrder(id = "o", displayId = 1, items = listOf(PartnerOrderItem(id = "i")))
        assertEquals("d-run", fromRun.resolveDesignId(listOf(ProductionRun(id = "r", designId = "d-run"))))

        assertNull(PartnerOrder(id = "o", displayId = 1).resolveDesignId(emptyList()))
    }
}

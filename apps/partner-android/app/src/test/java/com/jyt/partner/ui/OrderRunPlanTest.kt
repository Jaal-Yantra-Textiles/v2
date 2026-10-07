package com.jyt.partner.ui

import com.jyt.partner.models.ProductionRun
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

package com.jyt.partner.models

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime

class ProfitShareModelsTest {

    private val kolkata = ZoneId.of("Asia/Kolkata")
    private val now = ZonedDateTime.of(2026, 10, 13, 9, 5, 0, 123_000_000, kolkata)

    @Test
    fun `a sale today carries the current time with seconds and the offset`() {
        assertEquals(
            "2026-10-13T09:05:00+05:30",
            soldAtIso(LocalDate.of(2026, 10, 13), kolkata, now),
        )
    }

    @Test
    fun `a sale on an earlier day is stamped at local noon`() {
        assertEquals(
            "2026-10-01T12:00:00+05:30",
            soldAtIso(LocalDate.of(2026, 10, 1), kolkata, now),
        )
    }

    @Test
    fun `UTC still carries an explicit offset`() {
        val utc = ZoneId.of("UTC")
        assertEquals(
            "2026-10-01T12:00:00Z",
            soldAtIso(LocalDate.of(2026, 10, 1), utc, now.withZoneSameInstant(utc)),
        )
    }

    @Test
    fun `status labels are plain words`() {
        assertEquals("No sales yet", profitShareStatusLabel("no_sales"))
        assertEquals("Overpaid", profitShareStatusLabel("overpaid"))
        assertEquals("—", profitShareStatusLabel(null))
    }
}

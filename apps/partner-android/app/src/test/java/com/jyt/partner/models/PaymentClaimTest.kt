package com.jyt.partner.models

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PaymentClaimTest {
    private val json = Json { ignoreUnknownKeys = true; isLenient = true; coerceInputValues = true; explicitNulls = false; encodeDefaults = true }

    private fun run(
        id: String,
        design: String,
        qty: Double,
        rate: Double,
        amount: Double = qty * rate,
        derived: Boolean = false,
        billing: String = "clear",
        openSubmission: Boolean = false,
    ) = PayableRun(
        runId = id, designId = design, designName = "D-$design",
        payableQuantity = qty, unitAmount = rate, unitIsDerived = derived, amount = amount,
        billingStatus = billing, designHasOpenSubmission = openSubmission,
    )

    @Test
    fun `one rate across a design's runs goes on unit_amounts with quantities summed`() {
        val body = PaymentClaim.build(listOf(run("r1", "d1", 3.0, 850.0), run("r2", "d1", 5.0, 850.0)), null)
        assertEquals(listOf("d1"), body.designIds)
        assertEquals(mapOf("d1" to listOf("r1", "r2")), body.productionRunIds)
        assertEquals(mapOf("d1" to 8.0), body.quantities)
        assertEquals(mapOf("d1" to 850.0), body.unitAmounts)
        assertNull(body.costOverrides)
        assertNull(body.rateBreakdown)
    }

    @Test
    fun `an agreed total is billed verbatim on cost_overrides, never as a rate`() {
        // ₹10,000 for 9 pieces: the derived rate 1111.11 must not be multiplied.
        val r = run("r1", "d1", 9.0, 1111.11, amount = 10000.0, derived = true)
        assertEquals(10000.0, PaymentClaim.lineAmount(r), 0.0)
        val body = PaymentClaim.build(listOf(r), null)
        assertEquals(mapOf("d1" to 10000.0), body.costOverrides)
        assertNull(body.unitAmounts)
    }

    @Test
    fun `different rates on one design become rate bands, not a total`() {
        val body = PaymentClaim.build(listOf(run("r1", "d1", 3.0, 1200.0), run("r2", "d1", 1.0, 850.0)), "two batches")
        assertEquals(
            mapOf("d1" to listOf(RateBand(1.0, 850.0), RateBand(3.0, 1200.0))),
            body.rateBreakdown,
        )
        assertNull(body.costOverrides)
        assertNull(body.unitAmounts)
        assertEquals("two batches", body.notes)
    }

    @Test
    fun `a part-billed agreed total needs a typed price, so the app can't claim it`() {
        val r = run("r1", "d1", 4.0, 500.0, amount = 2000.0, derived = true, billing = "partly_billed")
        assertTrue(PaymentClaim.needsTypedPrice(r))
        assertEquals(0.0, PaymentClaim.lineAmount(r), 0.0)
        assertFalse(PaymentClaim.canClaim(r))
    }

    @Test
    fun `billed runs and designs with an open request are blocked, part-billed rated runs are not`() {
        assertFalse(PaymentClaim.canClaim(run("a", "d", 1.0, 100.0, billing = "billed")))
        assertFalse(PaymentClaim.canClaim(run("b", "d", 1.0, 100.0, openSubmission = true)))
        assertFalse(PaymentClaim.canClaim(run("c", "d", 1.0, 0.0)))
        assertTrue(PaymentClaim.canClaim(run("e", "d", 2.0, 100.0, billing = "partly_billed")))
    }

    @Test
    fun `the request body omits what it doesn't set`() {
        val encoded = json.encodeToString(
            CreatePaymentSubmissionBody.serializer(),
            PaymentClaim.build(listOf(run("r1", "d1", 2.0, 400.0)), ""),
        )
        assertEquals(
            """{"design_ids":["d1"],"production_run_ids":{"d1":["r1"]},"quantities":{"d1":2.0},"unit_amounts":{"d1":400.0}}""",
            encoded,
        )
    }

    @Test
    fun `a submission decodes and knows which runs it claims`() {
        val s = json.decodeFromString(
            PaymentSubmissionResponse.serializer(),
            """{"payment_submission":{"id":"ps_1","status":"Draft","total_amount":3400,"currency":"inr",
               "items":[{"id":"i1","source_type":"design","design_name":"Robe","amount":3400,"quantity":4,"unit_amount":850,"production_run_ids":["run_9"]}]}}""",
        ).paymentSubmission
        assertTrue(s.isDraft)
        assertTrue(s.claimsRun("run_9"))
        assertFalse(s.claimsRun("run_1"))
        assertEquals(3400.0, s.totalAmount, 0.0)
    }
}

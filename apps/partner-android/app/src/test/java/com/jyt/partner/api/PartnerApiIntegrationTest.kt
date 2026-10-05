package com.jyt.partner.api

import com.jyt.partner.models.ApiDate
import com.jyt.partner.models.PartnerException
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import java.text.SimpleDateFormat
import java.util.Locale

/**
 * The app↔API integration suite — the whole client (OkHttp, kotlinx
 * serialization, auth headers, URL building, multipart, error mapping)
 * driven against a local MockWebServer on the JVM. No emulator: the point
 * is that the REQUESTS the app makes match the contract the /partners
 * surface serves, and the RESPONSES it decodes match what the routes
 * return.
 *
 * The token store and base URL sit behind PartnerApi's test seams.
 */
class PartnerApiIntegrationTest {

    private lateinit var server: MockWebServer
    private lateinit var api: PartnerApi
    private lateinit var tokens: FakeTokens

    private class FakeTokens : PartnerApi.TokenAccess {
        var value: String? = null
        override fun load(context: android.content.Context?): String? = value
        override fun save(context: android.content.Context?, token: String) {
            value = token
        }

        override fun clear(context: android.content.Context?) {
            value = null
        }
    }

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        tokens = FakeTokens()
        api = PartnerApi.forTesting(server.url("/").toString().trimEnd('/'), tokens)
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun enqueueJson(body: String, code: Int = 200) {
        server.enqueue(
            MockResponse()
                .setResponseCode(code)
                .setHeader("Content-Type", "application/json")
                .setBody(body)
        )
    }

    private fun take(): okhttp3.mockwebserver.RecordedRequest = server.takeRequest()

    // ── Auth ─────────────────────────────────────────────────────────────

    @Test
    fun `login posts credentials and stores the token`() = runBlocking {
        enqueueJson("""{"token":"jwt-123"}""")

        val outcome = api.login("weaver@example.com", "s3cret")

        val request = take()
        assertEquals("POST", request.method)
        assertEquals("/auth/partner/emailpass", request.path)
        assertEquals(
            """{"email":"weaver@example.com","password":"s3cret"}""",
            request.body.readUtf8(),
        )
        assertNull(request.getHeader("Authorization")) // login itself is unauthenticated
        assertFalse(outcome.verificationRequired)
        assertEquals("jwt-123", tokens.value)
    }

    @Test
    fun `login surfaces verification_required without storing a token`() = runBlocking {
        enqueueJson("""{"verification_required":true}""")

        val outcome = api.login("weaver@example.com", "s3cret")

        assertTrue(outcome.verificationRequired)
        assertNull(tokens.value)
    }

    @Test
    fun `phone login posts phone and PIN and stores the token`() = runBlocking {
        enqueueJson("""{"token":"jwt-phone"}""")

        api.loginWithPhone("98765 43210", "482913")

        val request = take()
        assertEquals("POST", request.method)
        assertEquals("/auth/partner/phone-pin", request.path)
        assertEquals("""{"phone":"98765 43210","pin":"482913"}""", request.body.readUtf8())
        assertNull(request.getHeader("Authorization"))
        assertEquals("jwt-phone", tokens.value)
    }

    @Test
    fun `a phone login 401 keeps the server's lockout message`() = runBlocking {
        enqueueJson("""{"message":"Too many wrong PINs. Try again after 15 minutes."}""", code = 401)

        try {
            api.loginWithPhone("+919876543210", "111222")
            fail("expected PartnerException.Http")
        } catch (e: PartnerException.Http) {
            assertEquals(401, e.status)
            assertTrue(e.serverMessage.contains("Too many wrong PINs"))
        }
        assertNull(tokens.value)
    }

    @Test
    fun `the stored token rides every request as a Bearer header`() = runBlocking {
        tokens.value = "jwt-123"
        enqueueJson("""{"admin":{"id":"a1","email":"e@example.com"}}""")

        api.me()

        assertEquals("Bearer jwt-123", take().getHeader("Authorization"))
    }

    @Test
    fun `a 401 maps to the login message`() = runBlocking {
        enqueueJson("""{"message":"Unauthorized"}""", code = 401)

        try {
            api.me()
            fail("expected PartnerException.Http")
        } catch (e: PartnerException.Http) {
            assertEquals(401, e.status)
            assertEquals("Invalid email or password.", e.message)
        }
    }

    @Test
    fun `an error message is extracted from a JSON body`() = runBlocking {
        enqueueJson("""{"message":"Repeat confirmation refused"}""", code = 400)

        try {
            api.incomingDeliveries()
            fail("expected PartnerException.Http")
        } catch (e: PartnerException.Http) {
            assertEquals(400, e.status)
            assertEquals("Repeat confirmation refused", e.message)
        }
    }

    @Test
    fun `an error falls back to the error field`() = runBlocking {
        enqueueJson("""{"error":"Partner authentication required"}""", code = 403)

        try {
            api.incomingDeliveries()
            fail("expected PartnerException.Http")
        } catch (e: PartnerException.Http) {
            assertEquals("Partner authentication required", e.message)
        }
    }

    @Test
    fun `an error never shows the raw body`() = runBlocking {
        enqueueJson("""{"errors":[{"stack":"at node_modules/x.js"}]}""", code = 500)
        try {
            api.incomingDeliveries()
            fail("expected PartnerException.Http")
        } catch (e: PartnerException.Http) {
            assertFalse(e.message!!.contains("{"))
            assertTrue(e.message!!.contains("500"))
        }

        server.enqueue(MockResponse().setResponseCode(502).setBody("<html>Bad gateway</html>"))
        try {
            api.incomingDeliveries()
            fail("expected PartnerException.Http")
        } catch (e: PartnerException.Http) {
            assertFalse(e.message!!.contains("<html>"))
        }
    }

    @Test
    fun `an unparseable body throws InvalidResponse`() = runBlocking {
        server.enqueue(MockResponse().setBody("<html>gateway</html>"))

        try {
            api.me()
            fail("expected PartnerException.InvalidResponse")
        } catch (e: PartnerException.InvalidResponse) {
            // expected
        }
    }

    // ── Orders & designs ──────────────────────────────────────────────────

    @Test
    fun `orders list encodes its query and decodes rows with work status`() = runBlocking {
        enqueueJson(
            """
            {
              "orders": [
                {
                  "id": "o1", "display_id": 42, "status": "pending", "total": 4750.5,
                  "currency_code": "inr", "created_at": "2026-09-20T04:11:09.000Z",
                  "designs": [{"id": "d1", "name": "Tea towels", "thumbnail": "t.png"}],
                  "unified_order_status": {"partner_status": "in_progress"}
                }
              ],
              "count": 1, "offset": 0, "limit": 20
            }
            """.trimIndent()
        )

        val page = api.orders(kind = "design", limit = 20, offset = 40, query = "tea towel")

        val path = take().path!!
        assertTrue(path.startsWith("/partners/orders?"))
        assertTrue(path.contains("kind=design"))
        assertTrue(path.contains("limit=20"))
        assertTrue(path.contains("offset=40"))
        assertTrue(path.contains("q=tea+towel")) // URLEncoder space = +

        val order = page.orders.single()
        assertEquals(42, order.displayId)
        assertEquals("Tea towels", order.designs!!.single().name)
        assertEquals(com.jyt.partner.models.WorkStatus.IN_PROGRESS, order.workStatus)
    }

    @Test
    fun `order detail decodes items and run refs`() = runBlocking {
        enqueueJson(
            """
            {"order": {"id": "o1", "display_id": 7,
              "items": [{"id": "i1", "title": "Kani stole", "quantity": 2, "total": 1500}],
              "production_runs": [{"id": "run-9"}]}}
            """.trimIndent()
        )

        val order = api.order("o1")

        assertEquals("/partners/orders/o1", take().path)
        assertEquals("Kani stole", order.items!!.single().title)
        assertEquals("run-9", order.productionRuns!!.single().id)
    }

    @Test
    fun `run detail carries the run and its tasks`() = runBlocking {
        enqueueJson(
            """
            {"production_run": {"id": "run-9", "status": "in_progress", "quantity": 3,
              "started_at": "2026-09-22 04:11:09 GMT+1000 (AEST)"},
             "tasks": [{"id": "t1", "title": "Stitching", "status": "pending"}]}
            """.trimIndent()
        )

        val detail = api.productionRun("run-9")

        assertEquals("/partners/production-runs/run-9", take().path)
        assertEquals("in_progress", detail.productionRun.status)
        assertEquals(3.0, detail.productionRun.quantity!!, 0.0)
        assertEquals("Stitching", detail.tasks!!.single().title)
    }

    @Test
    fun `run detail decodes a float quantity and the cost fields`() = runBlocking {
        enqueueJson(
            """
            {"production_run": {"id": "run-9", "status": "completed", "quantity": 12.5,
              "produced_quantity": 12, "partner_cost_estimate": 450, "cost_type": "per_unit",
              "cost_currency": "inr"}}
            """.trimIndent()
        )

        val run = api.productionRun("run-9").productionRun

        assertEquals(12.5, run.quantity!!, 0.0)
        assertEquals(12.0, run.producedQuantity!!, 0.0)
        assertEquals(450.0, run.partnerCostEstimate!!, 0.0)
        assertEquals("per_unit", run.costType)
        assertEquals("inr", run.costCurrency)
    }

    @Test
    fun `cost summary decodes the partner rate, total and cost per piece`() = runBlocking {
        enqueueJson(
            """
            {"cost_summary": {"currency": "inr", "quantity": 10, "produced_quantity": 9,
              "partner": {"estimate": 45, "cost_type": "per_unit", "total": 450},
              "material": {"total": 120.5, "items": []}, "energy": {"total": 0, "breakdown": []},
              "grand_total": 570.5, "cost_per_unit": 57.05}}
            """.trimIndent()
        )

        val summary = api.productionRunCostSummary("run-9")

        assertEquals("/partners/production-runs/run-9/cost-summary", take().path)
        assertEquals("inr", summary.currency)
        assertEquals(45.0, summary.partner!!.estimate!!, 0.0)
        assertEquals("per_unit", summary.partner!!.costType)
        assertEquals(450.0, summary.partner!!.total!!, 0.0)
        assertEquals(120.5, summary.material!!.total!!, 0.0)
        assertEquals(57.05, summary.costPerUnit!!, 0.0)
    }

    // ── Run lifecycle ─────────────────────────────────────────────────────

    @Test
    fun `accept and start post empty JSON to their endpoints`() = runBlocking {
        enqueueJson("{}")
        api.acceptRun("run-9")
        val accept = take()
        assertEquals("/partners/production-runs/run-9/accept", accept.path)
        assertEquals("{}", accept.body.readUtf8())

        enqueueJson("{}")
        api.startRun("run-9")
        assertEquals("/partners/production-runs/run-9/start", take().path)
    }

    @Test
    fun `finish sends notes only when present`() = runBlocking {
        enqueueJson("{}")
        api.finishRun("run-9", notes = "  ") // blank → treated as absent
        assertEquals("{}", take().body.readUtf8())

        enqueueJson("{}")
        api.finishRun("run-9", notes = "selvedge loose")
        assertEquals("""{"notes":"selvedge loose"}""", take().body.readUtf8())
    }

    @Test
    fun `complete posts the full snake_case payload with consumptions and shortfall`() =
        runBlocking {
            enqueueJson("{}")

            api.completeRun(
                "run-9",
                PartnerApi.CompleteRunBody(
                    producedQuantity = 9,
                    rejectedQuantity = 1,
                    rejectionReason = "fabric_flaw",
                    rejectionNotes = "torn weft",
                    partnerCostEstimate = 450.0,
                    costType = "per_unit",
                    allowShortfall = true,
                    notes = "Shortfall explanation: loom broke",
                    consumptions = listOf(
                        PartnerApi.ConsumptionEntry(
                            inventoryItemId = "iitem-1",
                            quantity = 2.5,
                            unitCost = 180.0,
                            unitOfMeasure = "Meter",
                            consumptionType = "production",
                        )
                    ),
                ),
            )

            val body = take().body.readUtf8()
            assertTrue(body.contains("\"produced_quantity\":9"))
            assertTrue(body.contains("\"rejected_quantity\":1"))
            assertTrue(body.contains("\"rejection_reason\":\"fabric_flaw\""))
            assertTrue(body.contains("\"partner_cost_estimate\":450.0"))
            assertTrue(body.contains("\"cost_type\":\"per_unit\""))
            assertTrue(body.contains("\"allow_shortfall\":true"))
            assertTrue(body.contains("\"inventory_item_id\":\"iitem-1\""))
            assertTrue(body.contains("\"quantity\":2.5"))
            assertTrue(body.contains("\"unit_cost\":180.0"))
            assertTrue(body.contains("\"consumption_type\":\"production\""))
        }

    // ── Media upload ──────────────────────────────────────────────────────

    @Test
    fun `run media uploads as a well-formed multipart with field name files`() = runBlocking {
        enqueueJson("""{"files": [{"id": "f1", "url": "https://cdn/x.jpg"}]}""")
        enqueueJson("{}") // the attach POST's response

        val uploaded = api.uploadRunMedia(
            "run-9",
            listOf(PartnerApi.MediaPart("photo.jpg", "image/jpeg", byteArrayOf(1, 2, 3))),
        )
        api.attachRunMedia("run-9", uploaded)

        val upload = take()
        assertEquals("/partners/production-runs/run-9/media", upload.path)
        val contentType = upload.getHeader("Content-Type")!!
        assertTrue(contentType.startsWith("multipart/form-data; boundary=JYTPartnerBoundary-"))
        val body = upload.body.readUtf8()
        assertTrue(body.contains("""Content-Disposition: form-data; name="files"; filename="photo.jpg""""))
        assertTrue(body.contains("Content-Type: image/jpeg"))

        val attach = take()
        assertEquals("/partners/production-runs/run-9/media/attach", attach.path)
        val attachBody = attach.body.readUtf8()
        assertTrue(attachBody.contains("\"media_files\":[{\"id\":\"f1\",\"url\":\"https://cdn/x.jpg\"}]"))
    }

    // ── Inventory orders (the partner is the supplier) ───────────────────

    @Test
    fun `goods receipt posts the delivery date and per-line quantities`() = runBlocking {
        enqueueJson("{}")

        api.completeInventoryOrder(
            "inv-1",
            com.jyt.partner.models.CompleteInventoryOrderBody(
                notes = "sent by truck",
                deliveryDate = "2026-09-25",
                trackingNumber = "TRK-7",
                lines = listOf(
                    com.jyt.partner.models.CompleteInventoryOrderBody.Line("line-1", 2.5),
                    com.jyt.partner.models.CompleteInventoryOrderBody.Line("line-2", 0.0),
                ),
            ),
        )

        val request = take()
        assertEquals("/partners/inventory-orders/inv-1/complete", request.path)
        val body = request.body.readUtf8()
        assertTrue(body.contains("\"deliveryDate\":\"2026-09-25\""))
        assertTrue(body.contains("\"trackingNumber\":\"TRK-7\""))
        assertTrue(body.contains("\"order_line_id\":\"line-1\""))
        assertTrue(body.contains("\"quantity\":2.5"))
    }

    // ── Incoming deliveries (the partner is the receiver, #2286) ─────────

    @Test
    fun `incoming deliveries decode lines, flags and the no-warehouse case`() = runBlocking {
        enqueueJson(
            """
            {
              "incoming_deliveries": [
                {"id": "inv-2", "status": "Shipped", "from": "GOF Warehouse",
                 "expected_delivery_date": "2026-09-28", "is_sample": false,
                 "lines": [
                   {"id": "l1", "name": "Kala cotton", "unit": "Meter",
                    "ordered": 70.6, "received": 60, "outstanding": 10.6}
                 ],
                 "outstanding": 10.6, "fully_received": false,
                 "can_confirm": true, "cannot_confirm_reason": null}
              ],
              "count": 1, "location_id": "sloc_123"
            }
            """.trimIndent()
        )

        val response = api.incomingDeliveries(all = true)

        assertEquals("/partners/incoming-deliveries?all=true", take().path)
        val delivery = response.incomingDeliveries.single()
        assertEquals("GOF Warehouse", delivery.from)
        assertEquals(10.6, delivery.outstanding, 0.0)
        assertTrue(delivery.canConfirm!!)
        assertNull(delivery.cannotConfirmReason)
        val line = delivery.lines.single()
        assertEquals("Kala cotton", line.name)
        assertEquals(70.6, line.ordered, 0.0)
        assertEquals(10.6, line.outstanding, 0.0)
        assertEquals(com.jyt.partner.models.InventoryOrderStatus.SHIPPED, delivery.statusEnum)

        // Default list omits ?all.
        enqueueJson("""{"incoming_deliveries": [], "count": 0, "location_id": null}""")
        val noWarehouse = api.incomingDeliveries()
        assertEquals("/partners/incoming-deliveries", take().path)
        assertNull(noWarehouse.locationId)
    }

    @Test
    fun `receive incoming delivery posts every line and the required note`() = runBlocking {
        enqueueJson("""{"received": true}""")

        api.receiveIncomingDelivery(
            "inv-2",
            com.jyt.partner.models.ReceiveIncomingBody(
                lines = listOf(
                    com.jyt.partner.models.ReceiveIncomingBody.Line("l1", 60.0),
                    com.jyt.partner.models.ReceiveIncomingBody.Line("l2", 0.0),
                ),
                notes = "2 m short — bolt was cut",
            ),
        )

        val request = take()
        assertEquals("/partners/incoming-deliveries/inv-2/receive", request.path)
        assertEquals("POST", request.method)
        val body = request.body.readUtf8()
        assertTrue(body.contains("\"order_line_id\":\"l1\""))
        assertTrue(body.contains("\"quantity\":60.0"))
        assertTrue(body.contains("\"order_line_id\":\"l2\""))
        assertTrue(body.contains("\"quantity\":0.0")) // a line that brought nothing
        assertTrue(body.contains("\"notes\":\"2 m short — bolt was cut\""))
    }

    // ── Inventory order: ready for delivery, carrier shipments ────────────

    @Test
    fun `ready for delivery posts to its route`() = runBlocking {
        enqueueJson("""{"order":{"id":"inv-1","status":"Ready for Delivery"}}""")
        api.markInventoryOrderReadyForDelivery("inv-1")

        val request = take()
        assertEquals("POST", request.method)
        assertEquals("/partners/inventory-orders/inv-1/ready-for-delivery", request.path)
    }

    @Test
    fun `order detail decodes its shipments`() = runBlocking {
        enqueueJson(
            """
            {"inventoryOrder": {"id": "inv-1", "status": "Shipped", "order_lines": [],
              "shipments": [{"id": "ish_1", "carrier": "shiprocket", "awb": "AWB123",
                "status": "pickup_scheduled", "pickup_scheduled_date": "2026-10-05",
                "metadata": {"x": 1}}]}}
            """.trimIndent()
        )

        val order = api.inventoryOrder("inv-1")

        val shipment = order.shipments!!.single()
        assertEquals("shiprocket", shipment.carrier)
        assertEquals("AWB123", shipment.awb)
        assertEquals("pickup_scheduled", shipment.status)
        assertEquals("2026-10-05", shipment.pickupScheduledDate)
    }

    @Test
    fun `rates query carries the carrier and only the refinements given`() = runBlocking {
        enqueueJson(
            """
            {"origin_pincode": "110001", "destination_pincode": "400001", "weight_grams": 1500,
             "cod": false, "rates": [
               {"courier_id": 24, "courier_name": "Xpressbees", "amount": 140.5, "currency_code": "INR", "estimated_days": 4},
               {"courier_id": "10", "courier_name": "Delhivery Air", "amount": 99, "currency_code": "INR", "is_recommended": true}
             ]}
            """.trimIndent()
        )

        val quote = api.inventoryOrderShippingRates(
            orderId = "inv-1",
            carrier = "shiprocket",
            weightGrams = 1500,
            length = 30.0,
            height = 12.5,
        )

        assertEquals(
            "/partners/inventory-orders/inv-1/shiprocket-rates?carrier=shiprocket&weight_grams=1500&length=30&height=12.5",
            take().path,
        )
        assertEquals(listOf("24", "10"), quote.rates.map { it.courierId })
        assertEquals(140.5, quote.rates[0].amount, 0.0)
        assertEquals(true, quote.rates[1].isRecommended)
    }

    @Test
    fun `create shipment posts the snake_case body and returns the AWB`() = runBlocking {
        enqueueJson(
            """
            {"shipment": {"carrier": "shiprocket", "awb": "AWB999", "tracking_number": "AWB999",
              "tracking_url": "https://track/AWB999", "pickup": {"scheduled_date": "2026-10-05"}}}
            """.trimIndent()
        )

        val shipment = api.createInventoryOrderShipment(
            "inv-1",
            com.jyt.partner.models.CreateShipmentBody(
                carrier = "shiprocket",
                weightGrams = 1500,
                dimensionsCm = com.jyt.partner.models.CreateShipmentBody.Dimensions(30.0, 20.0, 10.0),
                preferredCourierId = "24",
                pickupDate = "2026-10-05",
            ),
        )

        val request = take()
        assertEquals("POST", request.method)
        assertEquals("/partners/inventory-orders/inv-1/shipment", request.path)
        assertEquals(
            """{"carrier":"shiprocket","weight_grams":1500,"dimensions_cm":{"length":30.0,"breadth":20.0,"height":10.0},"preferred_courier_id":"24","pickup_date":"2026-10-05"}""",
            request.body.readUtf8(),
        )
        assertEquals("AWB999", shipment.awb)
        assertEquals("2026-10-05", shipment.pickup?.scheduledDate)
    }

    @Test
    fun `create shipment leaves out what the partner did not fill`() = runBlocking {
        enqueueJson("""{"shipment": {"awb": "A1"}}""")

        api.createInventoryOrderShipment(
            "inv-1",
            com.jyt.partner.models.CreateShipmentBody(carrier = "delhivery", pickupDate = "2026-10-05"),
        )

        assertEquals(
            """{"carrier":"delhivery","pickup_date":"2026-10-05"}""",
            take().body.readUtf8(),
        )
    }

    @Test
    fun `a shipment error shows the server message as is`() = runBlocking {
        val message = "Pickup address must include a house/flat/road number."
        enqueueJson("""{"message":"$message"}""", code = 400)

        try {
            api.createInventoryOrderShipment(
                "inv-1",
                com.jyt.partner.models.CreateShipmentBody(carrier = "shiprocket"),
            )
            fail("expected PartnerException.Http")
        } catch (e: PartnerException.Http) {
            assertEquals(message, e.message)
        }
    }

    // ── Push device tokens ────────────────────────────────────────────────

    @Test
    fun `device tokens register and unregister with the right verbs`() = runBlocking {
        enqueueJson("{}")
        api.registerDeviceToken("fcm-token-1", appVersion = "0.1.1")

        val register = take()
        assertEquals("/partners/device-tokens", register.path)
        assertEquals("POST", register.method)
        val registerBody = register.body.readUtf8()
        assertTrue(registerBody.contains("\"token\":\"fcm-token-1\""))
        assertTrue(registerBody.contains("\"platform\":\"android\""))
        assertTrue(registerBody.contains("\"app_version\":\"0.1.1\""))

        enqueueJson("{}")
        api.unregisterDeviceToken("fcm-token-1")

        val unregister = take()
        assertEquals("/partners/device-tokens", unregister.path)
        assertEquals("DELETE", unregister.method)
        assertEquals("""{"token":"fcm-token-1"}""", unregister.body.readUtf8())
    }
}

// ── ApiDate: the two wire formats the backend emits ──────────────────────

class ApiDateTest {

    @Test
    fun `parses ISO-8601 with millis and a UTC Z`() {
        val date = ApiDate.parse("2026-09-20T04:11:09.123Z")!!
        val utc = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US)
        utc.timeZone = java.util.TimeZone.getTimeZone("UTC")
        assertEquals("2026-09-20 04:11:09", utc.format(date))
    }

    @Test
    fun `parses ISO-8601 without millis and with an offset`() {
        // Regression: the throwing parse crashed here before the mismatch
        // could fall through to the no-millis format.
        val date = ApiDate.parse("2026-09-20T14:11:09+05:30")!!
        val utc = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US)
        utc.timeZone = java.util.TimeZone.getTimeZone("UTC")
        assertEquals("2026-09-20 08:41", utc.format(date))
    }

    @Test
    fun `parses the JS Date toString format some routes emit`() {
        // Regression: same crash — the first ISO pattern threw on "Wed"
        // before the JS format was ever tried.
        val date = ApiDate.parse("Wed Sep 23 2026 09:18:09 GMT+1000 (AEST)")!!
        val utc = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US)
        utc.timeZone = java.util.TimeZone.getTimeZone("UTC")
        assertEquals("2026-09-22 23:18", utc.format(date))
    }

    @Test
    fun `blank and null parse to null`() {
        assertNull(ApiDate.parse(null))
        assertNull(ApiDate.parse(""))
        assertNull(ApiDate.parse("   "))
    }
}

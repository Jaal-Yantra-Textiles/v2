package com.jyt.partner.api

import android.content.Context
import android.util.Log
import com.jyt.partner.BuildConfig
import com.jyt.partner.TokenStore
import com.jyt.partner.models.AttachMediaBody
import com.jyt.partner.models.CreatePaymentSubmissionBody
import com.jyt.partner.models.PartnerPaymentsResponse
import com.jyt.partner.models.PayableRunsResponse
import com.jyt.partner.models.PaymentSubmission
import com.jyt.partner.models.PaymentSubmissionListResponse
import com.jyt.partner.models.PaymentSubmissionResponse
import com.jyt.partner.models.SubmitPaymentBody
import com.jyt.partner.models.AttachMediaFile
import com.jyt.partner.models.CompleteInventoryOrderBody
import com.jyt.partner.models.CreateShipmentBody
import com.jyt.partner.models.CreateShipmentResponse
import com.jyt.partner.models.CreatedShipment
import com.jyt.partner.models.DesignDetail
import com.jyt.partner.models.DesignDetailResponse
import com.jyt.partner.models.IncomingDeliveriesResponse
import com.jyt.partner.models.InventoryOrderChargesResponse
import com.jyt.partner.models.MoodboardBoardsResponse
import com.jyt.partner.models.PartnerDesignListResponse
import com.jyt.partner.models.PartnerException
import com.jyt.partner.models.PartnerInventoryOrder
import com.jyt.partner.models.PartnerInventoryOrderDetailResponse
import com.jyt.partner.models.PartnerInventoryOrderListResponse
import com.jyt.partner.models.PartnerMe
import com.jyt.partner.models.PartnerOrder
import com.jyt.partner.models.PartnerOrderDetailResponse
import com.jyt.partner.models.PartnerOrderListResponse
import com.jyt.partner.models.ProductionRunDetail
import com.jyt.partner.models.ProductionRunListResponse
import com.jyt.partner.models.ReceiveIncomingBody
import com.jyt.partner.models.RunCostSummary
import com.jyt.partner.models.RunCostSummaryResponse
import com.jyt.partner.models.ShippingRatesResponse
import com.jyt.partner.models.UploadFile
import com.jyt.partner.models.UploadFilesResponse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.serializer
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/**
 * The partner API client — the Kotlin counterpart of the iOS app's
 * PartnerAPI actor. All requests run against the /partners surface with
 * the JWT from the encrypted token store.
 *
 * URL building splits path and query explicitly (the iOS app learned this
 * the hard way: appending mangles the `?`); dates stay strings in the
 * models and parse through ApiDate, which takes ISO-8601 AND the JS
 * `Date.toString()` format some design routes emit.
 *
 * The token store and base URL sit behind small seams ([TokenAccess] /
 * [baseUrlOverride]) so the integration tests can drive the whole client
 * — OkHttp, serialization, auth headers, multipart — against a local
 * mock server on the JVM, no emulator.
 *
 * Session keep-alive: JWTs live one day. [refreshToken] swaps the stored
 * token for a fresh one (the backend accepts one up to 30 days expired),
 * and every authenticated call that gets a 401 refreshes once and retries
 * once. When that cannot recover the session, [sessionExpired] fires and
 * the call throws [PartnerException.SessionExpired].
 */
class PartnerApi private constructor(
    private val context: Context?,
    private val baseUrlOverride: String? = null,
    private val tokens: TokenAccess = RealTokenAccess,
) {

    /** The JWT store seam — the encrypted TokenStore in production, an
     *  in-memory map in tests. */
    internal interface TokenAccess {
        fun load(context: Context?): String?
        fun save(context: Context?, token: String)
        fun clear(context: Context?)

        /** When the token was last issued or refreshed (epoch millis). */
        fun lastRefreshAt(context: Context?): Long? = null
        fun saveLastRefreshAt(context: Context?, epochMillis: Long) {}
    }

    internal object RealTokenAccess : TokenAccess {
        override fun load(context: Context?): String? =
            context?.let { TokenStore.loadToken(it) }

        override fun save(context: Context?, token: String) {
            context?.let { TokenStore.saveToken(it, token) }
        }

        override fun clear(context: Context?) {
            context?.let { TokenStore.clearToken(it) }
        }

        override fun lastRefreshAt(context: Context?): Long? =
            context?.let { TokenStore.lastRefreshAt(it) }

        override fun saveLastRefreshAt(context: Context?, epochMillis: Long) {
            context?.let { TokenStore.saveLastRefreshAt(it, epochMillis) }
        }
    }

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        coerceInputValues = true
        explicitNulls = false
        // Wire contracts: default-valued fields (DeviceTokenBody.platform)
        // must still reach the server — the device-tokens zod makes
        // platform required, and kotlinx omits defaults without this.
        encodeDefaults = true
    }

    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    // ── Auth ────────────────────────────────────────────────────────────

    /** POST /auth/partner/emailpass — raw login so an unverified email
     *  surfaces as verificationRequired instead of an opaque 401. */
    data class LoginOutcome(val verificationRequired: Boolean, val email: String)

    @Serializable
    private data class LoginBody(val email: String, val password: String)

    suspend fun login(email: String, password: String): LoginOutcome {
        val map = postObject(
            "auth/partner/emailpass",
            json.encodeToString(LoginBody.serializer(), LoginBody(email, password)),
            retryOn401 = false,
        )
        if (map["verification_required"] as? Boolean == true) {
            return LoginOutcome(verificationRequired = true, email = email)
        }
        val token = map["token"] as? String ?: map["access_token"] as? String
            ?: throw PartnerException.InvalidResponse
        storeFreshToken(token)
        return LoginOutcome(verificationRequired = false, email = email)
    }

    /** POST /auth/partner/phone-pin — phone number + 6-digit PIN (#2320).
     *  The backend reads the number in any format and locks it after 5 wrong PINs. */
    @Serializable
    private data class PhonePinBody(val phone: String, val pin: String)

    suspend fun loginWithPhone(phone: String, pin: String) {
        val map = postObject(
            "auth/partner/phone-pin",
            json.encodeToString(PhonePinBody.serializer(), PhonePinBody(phone, pin)),
            retryOn401 = false,
        )
        val token = map["token"] as? String ?: map["access_token"] as? String
            ?: throw PartnerException.InvalidResponse
        storeFreshToken(token)
    }

    fun logout() {
        tokens.clear(context)
    }

    suspend fun me(): PartnerMe = get("partners/me")

    // ── Session refresh ─────────────────────────────────────────────────

    /** What a refresh attempt came to. */
    enum class RefreshOutcome {
        /** A new token is stored. */
        REFRESHED,
        /** The server refused (401) — the session is over; the token is cleared. */
        REJECTED,
        /** Network down or the server erred (5xx, odd body) — the old token is kept. */
        FAILED,
    }

    private val refreshMutex = Mutex()

    private val _sessionExpired = MutableSharedFlow<Unit>(
        extraBufferCapacity = 1,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )

    /** Fires when an authenticated call got a 401 the refresh could not fix. */
    val sessionExpired: SharedFlow<Unit> = _sessionExpired.asSharedFlow()

    /** True when a token is stored and it was issued/refreshed more than
     *  [maxAgeMillis] ago, or when that time is unknown. */
    fun refreshDue(
        nowMillis: Long = System.currentTimeMillis(),
        maxAgeMillis: Long = REFRESH_INTERVAL_MILLIS,
    ): Boolean {
        if (tokens.load(context) == null) return false
        val last = tokens.lastRefreshAt(context) ?: return true
        return nowMillis - last > maxAgeMillis
    }

    /** POST /partners/auth/refresh with the stored token (it may be expired)
     *  and store the new one. Shares a mutex with the 401-retry refresh. */
    suspend fun refreshToken(): RefreshOutcome = refreshMutex.withLock {
        val current = tokens.load(context) ?: return@withLock RefreshOutcome.REJECTED
        refreshLocked(current)
    }

    /** Called under [refreshMutex]. Never goes through the 401-retry path. */
    private suspend fun refreshLocked(token: String): RefreshOutcome {
        val request = Request.Builder()
            .url(url("partners/auth/refresh"))
            .header("Authorization", "Bearer $token")
            .post("{}".toRequestBody("application/json".toMediaType()))
            .build()
        val (status, data) = try {
            send(request)
        } catch (e: java.io.IOException) {
            return RefreshOutcome.FAILED
        }
        if (status == 401) {
            // Only clear the token we tried to refresh — a newer sign-in stays.
            if (tokens.load(context) == token) tokens.clear(context)
            return RefreshOutcome.REJECTED
        }
        if (status !in 200..299) return RefreshOutcome.FAILED
        val fresh = runCatching {
            (Json.parseToJsonElement(String(data)).jsonObject["token"] as? JsonPrimitive)
                ?.takeIf { it.isString }?.content
        }.getOrNull()?.takeIf { it.isNotBlank() } ?: return RefreshOutcome.FAILED
        storeFreshToken(fresh)
        return RefreshOutcome.REFRESHED
    }

    private fun storeFreshToken(token: String) {
        tokens.save(context, token)
        tokens.saveLastRefreshAt(context, System.currentTimeMillis())
    }

    /** What [recoverFrom401] found. */
    private sealed interface Recovery {
        data class Retry(val token: String) : Recovery
        data object Expired : Recovery
        data object Unavailable : Recovery
    }

    /**
     * After [staleToken] drew a 401, make sure a usable token is stored.
     * Concurrent 401s queue on the mutex; those arriving after a successful
     * refresh see the token has changed and retry with it, no second refresh.
     */
    private suspend fun recoverFrom401(staleToken: String): Recovery = refreshMutex.withLock {
        val current = tokens.load(context) ?: return@withLock Recovery.Expired
        if (current != staleToken) return@withLock Recovery.Retry(current)
        when (refreshLocked(current)) {
            RefreshOutcome.REFRESHED ->
                tokens.load(context)?.let { Recovery.Retry(it) } ?: Recovery.Expired
            RefreshOutcome.REJECTED -> Recovery.Expired
            // Network/5xx — no verdict on the session, so don't sign out.
            RefreshOutcome.FAILED -> Recovery.Unavailable
        }
    }

    // ── Orders ──────────────────────────────────────────────────────────

    suspend fun orders(
        kind: String = "design",
        limit: Int = 20,
        offset: Int = 0,
        query: String? = null,
    ): PartnerOrderListResponse {
        var path = "partners/orders?kind=$kind&limit=$limit&offset=$offset"
        if (!query.isNullOrBlank()) path += "&q=${urlEncode(query)}"
        return get(path)
    }

    suspend fun order(id: String): PartnerOrder =
        get<PartnerOrderDetailResponse>("partners/orders/$id").order

    // ── Designs & production runs ───────────────────────────────────────

    suspend fun designs(
        limit: Int = 20,
        offset: Int = 0,
        query: String? = null,
    ): PartnerDesignListResponse {
        var path = "partners/designs?limit=$limit&offset=$offset"
        if (!query.isNullOrBlank()) path += "&q=${urlEncode(query)}"
        return get(path)
    }

    suspend fun design(id: String): DesignDetail =
        get<DesignDetailResponse>("partners/designs/$id").design

    /** The design's moodboards from this partner's view: their own plus everyone else's (#2017). */
    suspend fun designMoodboards(id: String): MoodboardBoardsResponse =
        get("partners/designs/$id/moodboards")

    suspend fun productionRuns(
        designId: String? = null,
        limit: Int = 20,
        offset: Int = 0,
    ): ProductionRunListResponse {
        var path = "partners/production-runs?limit=$limit&offset=$offset"
        if (designId != null) path += "&design_id=$designId"
        return get(path)
    }

    suspend fun productionRun(id: String): ProductionRunDetail =
        get("partners/production-runs/$id")

    /** The run's cost rollup — your rate and total, materials, cost per piece. */
    suspend fun productionRunCostSummary(id: String): RunCostSummary =
        get<RunCostSummaryResponse>("partners/production-runs/$id/cost-summary").costSummary

    // ── Run lifecycle actions ────────────────────────────────────────────

    suspend fun acceptRun(id: String) {
        post("partners/production-runs/$id/accept")
    }

    suspend fun startRun(id: String) {
        post("partners/production-runs/$id/start")
    }

    @Serializable
    private data class FinishBody(val notes: String? = null)

    suspend fun finishRun(id: String, notes: String?) {
        post(
            "partners/production-runs/$id/finish",
            json.encodeToString(
                FinishBody.serializer(),
                FinishBody(notes?.takeIf { it.isNotBlank() })
            )
        )
    }

    @Serializable
    data class ConsumptionEntry(
        @SerialName("inventory_item_id") val inventoryItemId: String? = null,
        val quantity: Double,
        @SerialName("unit_cost") val unitCost: Double? = null,
        @SerialName("unit_of_measure") val unitOfMeasure: String? = null,
        @SerialName("consumption_type") val consumptionType: String? = null,
        val notes: String? = null,
    )

    @Serializable
    data class CompleteRunBody(
        @SerialName("produced_quantity") val producedQuantity: Int? = null,
        @SerialName("rejected_quantity") val rejectedQuantity: Int? = null,
        @SerialName("rejection_reason") val rejectionReason: String? = null,
        @SerialName("rejection_notes") val rejectionNotes: String? = null,
        @SerialName("partner_cost_estimate") val partnerCostEstimate: Double? = null,
        @SerialName("cost_type") val costType: String? = null,
        @SerialName("allow_shortfall") val allowShortfall: Boolean? = null,
        val notes: String? = null,
        val consumptions: List<ConsumptionEntry>? = null,
        /** Which sizes/colours were made — required when the run is for several (#2271). */
        @SerialName("produced_output") val producedOutput: List<com.jyt.partner.models.OutputLine>? = null,
    )

    // ── Payments ────────────────────────────────────────────────────────

    /** The partner's payment requests, newest first, each with its items. */
    suspend fun paymentSubmissions(limit: Int = 50): PaymentSubmissionListResponse =
        get("partners/payment-submissions?limit=$limit")

    suspend fun paymentSubmission(id: String): PaymentSubmission =
        get<PaymentSubmissionResponse>("partners/payment-submissions/$id").paymentSubmission

    /** Draft → Pending. Only a Draft can be submitted. */
    suspend fun submitPaymentSubmission(id: String, notes: String?) {
        post(
            "partners/payment-submissions/$id/submit",
            json.encodeToString(SubmitPaymentBody.serializer(), SubmitPaymentBody(notes?.takeIf { it.isNotBlank() })),
        )
    }

    /** Completed runs with what each would bill, including blocked ones. */
    suspend fun payableRuns(): PayableRunsResponse =
        get("partners/payment-submissions/payable-runs")

    /** Lands as Pending (a partner-created request is submitted at once). */
    suspend fun createPaymentSubmission(body: CreatePaymentSubmissionBody) {
        post(
            "partners/payment-submissions",
            json.encodeToString(CreatePaymentSubmissionBody.serializer(), body),
        )
    }

    /** Payouts made to this partner. The id must be the signed-in partner's. */
    suspend fun partnerPayments(partnerId: String, limit: Int = 50): PartnerPaymentsResponse =
        get("partners/$partnerId/payments?limit=$limit")

    suspend fun completeRun(id: String, body: CompleteRunBody) {
        post(
            "partners/production-runs/$id/complete",
            json.encodeToString(CompleteRunBody.serializer(), body)
        )
    }

    // ── Media upload ────────────────────────────────────────────────────
    // Two-step like the web: multipart upload → attach to the design.

    class MediaPart(
        val filename: String,
        val mimeType: String,
        val bytes: ByteArray,
    )

    suspend fun uploadRunMedia(runId: String, parts: List<MediaPart>): List<UploadFile> {
        val boundary = "JYTPartnerBoundary-${java.util.UUID.randomUUID()}"
        var payload = ByteArray(0)
        for (part in parts) {
            payload += "--$boundary\r\n".toByteArray()
            payload += "Content-Disposition: form-data; name=\"files\"; filename=\"${part.filename}\"\r\n".toByteArray()
            payload += "Content-Type: ${part.mimeType}\r\n\r\n".toByteArray()
            payload += part.bytes
            payload += "\r\n".toByteArray()
        }
        payload += "--$boundary--\r\n".toByteArray()

        val mediaType = "multipart/form-data; boundary=$boundary".toMediaType()
        val request = baseRequest("partners/production-runs/$runId/media")
            .post(payload.toRequestBody(mediaType)).build()
        val data = execute(request)
        return decodeBody<UploadFilesResponse>(data).files
    }

    /** Attach freshly uploaded files to the run's design. */
    suspend fun attachRunMedia(runId: String, files: List<UploadFile>) {
        val body = AttachMediaBody(
            mediaFiles = files.map { AttachMediaFile(id = it.id, url = it.url) }
        )
        post(
            "partners/production-runs/$runId/media/attach",
            json.encodeToString(AttachMediaBody.serializer(), body)
        )
    }

    // ── Inventory orders ────────────────────────────────────────────────

    suspend fun inventoryOrders(
        limit: Int = 20,
        offset: Int = 0,
        status: String? = null,
        query: String? = null,
    ): PartnerInventoryOrderListResponse {
        var path = "partners/inventory-orders?limit=$limit&offset=$offset"
        if (!status.isNullOrBlank()) path += "&status=${urlEncode(status)}"
        if (!query.isNullOrBlank()) path += "&q=${urlEncode(query)}"
        return get(path)
    }

    suspend fun inventoryOrder(id: String): PartnerInventoryOrder =
        get<PartnerInventoryOrderDetailResponse>("partners/inventory-orders/$id").inventoryOrder

    suspend fun inventoryOrderCharges(id: String): InventoryOrderChargesResponse =
        get("partners/inventory-orders/$id/charges")

    /** Pending → Processing — the partner acknowledges the commission. */
    suspend fun startInventoryOrder(id: String) {
        post("partners/inventory-orders/$id/start")
    }

    /** Partial → Ready for Delivery — goods packed. The backend allows it
     *  ONLY from Partial (a delivery must be recorded first; a full delivery
     *  goes straight to Shipped), and 400s from any other status. */
    suspend fun markInventoryOrderReadyForDelivery(id: String) {
        post("partners/inventory-orders/$id/ready-for-delivery")
    }

    /** The goods receipt: what was actually delivered, per line. */
    suspend fun completeInventoryOrder(id: String, body: CompleteInventoryOrderBody) {
        post(
            "partners/inventory-orders/$id/complete",
            json.encodeToString(CompleteInventoryOrderBody.serializer(), body)
        )
    }

    /** Courier quotes for the order's shipment, so the partner can choose one.
     *  Every refinement is optional; blanks are left off the query. */
    suspend fun inventoryOrderShippingRates(
        orderId: String,
        carrier: String,
        weightGrams: Int? = null,
        length: Double? = null,
        breadth: Double? = null,
        height: Double? = null,
    ): ShippingRatesResponse {
        var path = "partners/inventory-orders/$orderId/shiprocket-rates?carrier=${urlEncode(carrier)}"
        weightGrams?.let { path += "&weight_grams=$it" }
        length?.let { path += "&length=${plainNumber(it)}" }
        breadth?.let { path += "&breadth=${plainNumber(it)}" }
        height?.let { path += "&height=${plainNumber(it)}" }
        return get(path)
    }

    /** Book the carrier shipment (AWB + label, pickup on the given date). */
    suspend fun createInventoryOrderShipment(
        orderId: String,
        body: CreateShipmentBody,
    ): CreatedShipment {
        val request = baseRequest("partners/inventory-orders/$orderId/shipment")
            .post(
                json.encodeToString(CreateShipmentBody.serializer(), body)
                    .toRequestBody("application/json".toMediaType())
            ).build()
        return decodeBody<CreateShipmentResponse>(execute(request)).shipment
    }

    // ── Incoming deliveries (#2286) ──────────────────────────────────────
    // The other side of the inventory orders: goods delivered TO this
    // partner's warehouse, whoever supplies them.

    /** Default lists only what is still outstanding; all=true includes
     *  fully received orders too. */
    suspend fun incomingDeliveries(all: Boolean = false): IncomingDeliveriesResponse =
        get(if (all) "partners/incoming-deliveries?all=true" else "partners/incoming-deliveries")

    /** The receiving partner states what arrived, per line. */
    suspend fun receiveIncomingDelivery(orderId: String, body: ReceiveIncomingBody) {
        post(
            "partners/incoming-deliveries/$orderId/receive",
            json.encodeToString(ReceiveIncomingBody.serializer(), body)
        )
    }

    // ── Push device tokens ───────────────────────────────────────────────
    // The backend's notification-push provider fans out to whatever the
    // app registers here (POST /partners/device-tokens, which upserts).

    @Serializable
    private data class DeviceTokenBody(
        val token: String,
        val platform: String = "android",
        val app_version: String? = null,
    )

    suspend fun registerDeviceToken(token: String, appVersion: String? = null) {
        post(
            "partners/device-tokens",
            json.encodeToString(
                DeviceTokenBody.serializer(),
                DeviceTokenBody(token, app_version = appVersion)
            )
        )
    }

    @Serializable
    private data class UnregisterBody(val token: String)

    suspend fun unregisterDeviceToken(token: String) {
        val request = baseRequest("partners/device-tokens")
            .delete(
                json.encodeToString(UnregisterBody.serializer(), UnregisterBody(token))
                    .toRequestBody("application/json".toMediaType())
            ).build()
        execute(request)
    }

    // ── Plumbing ────────────────────────────────────────────────────────

    /** Build a request URL from "path" or "path?query" against the
     *  configured backend — path and query are separated explicitly so the
     *  query's `?` is never mangled. */
    private fun url(path: String): String {
        val base = (baseUrlOverride ?: BuildConfig.BACKEND_URL).trimEnd('/')
        return if (path.contains('?')) {
            val parts = path.split('?', limit = 2)
            "$base/${parts[0]}?${parts[1]}"
        } else {
            "$base/$path"
        }
    }

    private fun urlEncode(value: String): String =
        java.net.URLEncoder.encode(value, "UTF-8")

    /** "12" for 12.0, "12.5" otherwise — query values, never locale-formatted. */
    private fun plainNumber(value: Double): String =
        if (value == value.toLong().toDouble()) value.toLong().toString() else value.toString()

    private fun baseRequest(path: String): Request.Builder {
        val builder = Request.Builder().url(url(path))
        tokens.load(context)?.let {
            builder.header("Authorization", "Bearer $it")
        }
        return builder
    }

    /** One round trip — status and body, no error mapping. */
    private suspend fun send(request: Request): Pair<Int, ByteArray> =
        withContext(Dispatchers.IO) {
            client.newCall(request).execute().use { response ->
                response.code to (response.body?.bytes() ?: ByteArray(0))
            }
        }

    /**
     * Runs [request]. A 401 on an authenticated call refreshes the token
     * once and retries the call once; if the session can't be recovered,
     * [sessionExpired] fires and [PartnerException.SessionExpired] is thrown.
     * The login endpoints pass [retryOn401] = false: a 401 there is a wrong
     * password, not an expired session.
     */
    private suspend fun execute(request: Request, retryOn401: Boolean = true): ByteArray {
        val (status, data) = send(request)
        if (status in 200..299) return data

        val sentToken = request.header("Authorization")?.removePrefix("Bearer ")
        if (status != 401 || !retryOn401 || sentToken.isNullOrBlank()) {
            throw httpError(status, String(data))
        }

        val token = when (val recovery = recoverFrom401(sentToken)) {
            is Recovery.Retry -> recovery.token
            Recovery.Expired -> {
                _sessionExpired.tryEmit(Unit)
                throw PartnerException.SessionExpired
            }
            Recovery.Unavailable -> throw httpError(status, String(data))
        }

        val (retryStatus, retryData) = send(
            request.newBuilder().header("Authorization", "Bearer $token").build()
        )
        if (retryStatus in 200..299) return retryData
        if (retryStatus == 401) {
            _sessionExpired.tryEmit(Unit)
            throw PartnerException.SessionExpired
        }
        throw httpError(retryStatus, String(retryData))
    }

    /** The server's own words — `message`, else `error` — or nothing, in
     *  which case PartnerException.Http falls back to a short generic line.
     *  Never the raw body: a JSON dump or an HTML gateway page is not a
     *  message a partner can act on. */
    private fun httpError(status: Int, body: String): PartnerException {
        val message = runCatching {
            val obj = Json.parseToJsonElement(body).jsonObject
            listOf("message", "error").firstNotNullOfOrNull { key ->
                (obj[key] as? JsonPrimitive)
                    ?.takeIf { it.isString }
                    ?.content
                    ?.trim()
                    ?.takeIf { it.isNotEmpty() }
            }
        }.getOrNull()
        return PartnerException.Http(status, message ?: "")
    }

    private suspend inline fun <reified T> decodeBody(data: ByteArray): T {
        return try {
            json.decodeFromString<T>(String(data))
        } catch (e: kotlinx.serialization.SerializationException) {
            Log.w("PartnerApi", "decode failed: ${e.message?.take(160)}")
            throw PartnerException.InvalidResponse
        } catch (e: IllegalArgumentException) {
            throw PartnerException.InvalidResponse
        }
    }

    private suspend inline fun <reified T> get(path: String): T {
        val data = execute(baseRequest(path).get().build())
        return decodeBody<T>(data)
    }

    private suspend fun post(path: String, body: String? = null) {
        val request = baseRequest(path)
            .post((body ?: "{}").toRequestBody("application/json".toMediaType())).build()
        execute(request)
    }

    /** POST returning the parsed top-level JSON object (login). */
    private suspend fun postObject(
        path: String,
        body: String,
        retryOn401: Boolean = true,
    ): Map<String, Any?> {
        val request = baseRequest(path)
            .post(body.toRequestBody("application/json".toMediaType())).build()
        val data = execute(request, retryOn401)
        val element = runCatching { Json.parseToJsonElement(String(data)) }.getOrNull()
        val obj = element as? JsonObject ?: return emptyMap()
        return obj.mapValues { (_, v) ->
            when (v) {
                is JsonPrimitive -> when {
                    v.isString -> v.content
                    v.booleanOrNull != null -> v.booleanOrNull
                    v.doubleOrNull != null -> v.doubleOrNull
                    else -> null
                }
                else -> null
            }
        }
    }

    companion object {
        /** The foreground refresh runs once the token is older than this. */
        const val REFRESH_INTERVAL_MILLIS: Long = 6 * 60 * 60 * 1000L

        @Volatile
        private var instance: PartnerApi? = null

        fun get(context: Context): PartnerApi =
            instance ?: synchronized(this) {
                instance ?: PartnerApi(context.applicationContext).also { instance = it }
            }

        /** The integration-test entry point: a client against an explicit
         *  base URL with an in-memory token store — no Android framework. */
        internal fun forTesting(
            baseUrl: String,
            tokens: TokenAccess,
        ): PartnerApi = PartnerApi(context = null, baseUrlOverride = baseUrl, tokens = tokens)
    }
}

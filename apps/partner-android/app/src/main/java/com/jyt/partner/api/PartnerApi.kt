package com.jyt.partner.api

import android.content.Context
import android.util.Log
import com.jyt.partner.BuildConfig
import com.jyt.partner.TokenStore
import com.jyt.partner.models.AttachMediaBody
import com.jyt.partner.models.AttachMediaFile
import com.jyt.partner.models.CompleteInventoryOrderBody
import com.jyt.partner.models.DesignDetail
import com.jyt.partner.models.DesignDetailResponse
import com.jyt.partner.models.IncomingDeliveriesResponse
import com.jyt.partner.models.InventoryOrderChargesResponse
import com.jyt.partner.models.PartnerInventoryOrder
import com.jyt.partner.models.PartnerInventoryOrderDetailResponse
import com.jyt.partner.models.PartnerInventoryOrderListResponse
import com.jyt.partner.models.PartnerDesignListResponse
import com.jyt.partner.models.PartnerException
import com.jyt.partner.models.PartnerMe
import com.jyt.partner.models.PartnerOrder
import com.jyt.partner.models.PartnerOrderDetailResponse
import com.jyt.partner.models.PartnerOrderListResponse
import com.jyt.partner.models.ProductionRunDetail
import com.jyt.partner.models.ProductionRunListResponse
import com.jyt.partner.models.ReceiveIncomingBody
import com.jyt.partner.models.UploadFile
import com.jyt.partner.models.UploadFilesResponse
import kotlinx.coroutines.Dispatchers
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
 */
class PartnerApi private constructor(private val context: Context) {

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        coerceInputValues = true
        explicitNulls = false
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
            json.encodeToString(LoginBody.serializer(), LoginBody(email, password))
        )
        if (map["verification_required"] as? Boolean == true) {
            return LoginOutcome(verificationRequired = true, email = email)
        }
        val token = map["token"] as? String ?: map["access_token"] as? String
            ?: throw PartnerException.InvalidResponse
        TokenStore.saveToken(context, token)
        return LoginOutcome(verificationRequired = false, email = email)
    }

    fun logout() {
        TokenStore.clearToken(context)
    }

    suspend fun me(): PartnerMe = get("partners/me")

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
    )

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

    /** Processing/Partial → Ready for Delivery — goods packed. */
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
        val base = BuildConfig.BACKEND_URL.trimEnd('/')
        return if (path.contains('?')) {
            val parts = path.split('?', limit = 2)
            "$base/${parts[0]}?${parts[1]}"
        } else {
            "$base/$path"
        }
    }

    private fun urlEncode(value: String): String =
        java.net.URLEncoder.encode(value, "UTF-8")

    private fun baseRequest(path: String): Request.Builder {
        val builder = Request.Builder().url(url(path))
        TokenStore.loadToken(context)?.let {
            builder.header("Authorization", "Bearer $it")
        }
        return builder
    }

    private suspend fun execute(request: Request): ByteArray {
        return withContext(Dispatchers.IO) {
            client.newCall(request).execute().use { response ->
                val data = response.body?.bytes() ?: ByteArray(0)
                if (!response.isSuccessful) {
                    throw httpError(response.code, String(data))
                }
                data
            }
        }
    }

    private fun httpError(status: Int, body: String): PartnerException {
        val message = runCatching {
            val obj = Json.parseToJsonElement(body).jsonObject
            (obj["message"] as? JsonPrimitive)?.content
        }.getOrNull() ?: body.take(300)
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
    private suspend fun postObject(path: String, body: String): Map<String, Any?> {
        val request = baseRequest(path)
            .post(body.toRequestBody("application/json".toMediaType())).build()
        val data = execute(request)
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
        @Volatile
        private var instance: PartnerApi? = null

        fun get(context: Context): PartnerApi =
            instance ?: synchronized(this) {
                instance ?: PartnerApi(context.applicationContext).also { instance = it }
            }
    }
}

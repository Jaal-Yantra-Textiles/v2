package com.jyt.partner.api

import com.jyt.partner.models.PartnerException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

/**
 * Keeping partners signed in: POST /partners/auth/refresh, the single
 * refresh-and-retry on a 401, the session-expired signal, and the mutex
 * that stops concurrent 401s from refreshing twice. Driven against a
 * MockWebServer through PartnerApi's token seam, like the integration suite.
 */
class SessionRefreshTest {

    private lateinit var server: MockWebServer
    private lateinit var api: PartnerApi
    private lateinit var tokens: FakeTokens

    private class FakeTokens : PartnerApi.TokenAccess {
        @Volatile var value: String? = null
        @Volatile var refreshedAt: Long? = null

        override fun load(context: android.content.Context?): String? = value
        override fun save(context: android.content.Context?, token: String) {
            value = token
        }

        override fun clear(context: android.content.Context?) {
            value = null
            refreshedAt = null
        }

        override fun lastRefreshAt(context: android.content.Context?): Long? = refreshedAt
        override fun saveLastRefreshAt(context: android.content.Context?, epochMillis: Long) {
            refreshedAt = epochMillis
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

    private val meBody = """{"admin":{"id":"a1","email":"e@example.com"}}"""

    // ── refreshToken() ───────────────────────────────────────────────────

    @Test
    fun `refresh posts the stored token and stores the new one`() = runBlocking {
        tokens.value = "old-jwt"
        enqueueJson("""{"token":"new-jwt"}""")

        val outcome = api.refreshToken()

        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/partners/auth/refresh", request.path)
        assertEquals("Bearer old-jwt", request.getHeader("Authorization"))
        assertEquals(PartnerApi.RefreshOutcome.REFRESHED, outcome)
        assertEquals("new-jwt", tokens.value)
        assertNotNull(tokens.refreshedAt)
    }

    @Test
    fun `a refused refresh clears the token`() = runBlocking {
        tokens.value = "old-jwt"
        enqueueJson("""{"message":"Token can no longer be refreshed"}""", code = 401)

        assertEquals(PartnerApi.RefreshOutcome.REJECTED, api.refreshToken())
        assertNull(tokens.value)
    }

    @Test
    fun `a 5xx refresh keeps the old token`() = runBlocking {
        tokens.value = "old-jwt"
        enqueueJson("""{"message":"boom"}""", code = 503)

        assertEquals(PartnerApi.RefreshOutcome.FAILED, api.refreshToken())
        assertEquals("old-jwt", tokens.value)
        assertNull(tokens.refreshedAt)
    }

    @Test
    fun `a network failure on refresh keeps the old token`() = runBlocking {
        tokens.value = "old-jwt"
        server.shutdown() // connection refused

        assertEquals(PartnerApi.RefreshOutcome.FAILED, api.refreshToken())
        assertEquals("old-jwt", tokens.value)
    }

    @Test
    fun `login stamps the refresh time so the foreground check waits 6 h`() = runBlocking {
        enqueueJson("""{"token":"jwt-123"}""")
        api.login("weaver@example.com", "s3cret")

        val stamped = tokens.refreshedAt!!
        assertFalse(api.refreshDue(nowMillis = stamped + 60_000))
        assertTrue(api.refreshDue(nowMillis = stamped + PartnerApi.REFRESH_INTERVAL_MILLIS + 1))
    }

    @Test
    fun `refresh is due when the time is unknown, never without a token`() {
        tokens.value = "jwt"
        assertTrue(api.refreshDue())
        tokens.value = null
        assertFalse(api.refreshDue())
    }

    // ── retry on 401 ─────────────────────────────────────────────────────

    @Test
    fun `a 401 refreshes once and retries the call with the new token`() = runBlocking {
        tokens.value = "old-jwt"
        enqueueJson("""{"message":"Unauthorized"}""", code = 401)
        enqueueJson("""{"token":"new-jwt"}""")
        enqueueJson(meBody)

        val me = api.me()

        assertNotNull(me)
        val first = server.takeRequest()
        assertEquals("/partners/me", first.path)
        assertEquals("Bearer old-jwt", first.getHeader("Authorization"))
        val refresh = server.takeRequest()
        assertEquals("/partners/auth/refresh", refresh.path)
        assertEquals("Bearer old-jwt", refresh.getHeader("Authorization"))
        val retry = server.takeRequest()
        assertEquals("/partners/me", retry.path)
        assertEquals("Bearer new-jwt", retry.getHeader("Authorization"))
        assertEquals(3, server.requestCount)
        assertEquals("new-jwt", tokens.value)
    }

    @Test
    fun `a retried POST resends its body`() = runBlocking {
        tokens.value = "old-jwt"
        enqueueJson("{}", code = 401)
        enqueueJson("""{"token":"new-jwt"}""")
        enqueueJson("{}")

        api.finishRun("run-9", notes = "selvedge loose")

        server.takeRequest()
        server.takeRequest()
        val retry = server.takeRequest()
        assertEquals("/partners/production-runs/run-9/finish", retry.path)
        assertEquals("""{"notes":"selvedge loose"}""", retry.body.readUtf8())
    }

    @Test
    fun `a refused refresh signals session expired and does not retry`() = runBlocking {
        tokens.value = "old-jwt"
        val expired = async(start = CoroutineStart.UNDISPATCHED) { api.sessionExpired.first() }
        enqueueJson("{}", code = 401)
        enqueueJson("""{"message":"expired too long ago"}""", code = 401)

        try {
            api.me()
            fail("expected SessionExpired")
        } catch (e: PartnerException.SessionExpired) {
            assertEquals("Your session expired, please sign in again.", e.message)
        }

        withTimeout(2_000) { expired.await() }
        assertEquals(2, server.requestCount)
        assertNull(tokens.value)
    }

    @Test
    fun `a 401 on the retried call signals session expired`() = runBlocking {
        tokens.value = "old-jwt"
        val expired = async(start = CoroutineStart.UNDISPATCHED) { api.sessionExpired.first() }
        enqueueJson("{}", code = 401)
        enqueueJson("""{"token":"new-jwt"}""")
        enqueueJson("{}", code = 401)

        try {
            api.me()
            fail("expected SessionExpired")
        } catch (e: PartnerException.SessionExpired) {
            // expected
        }

        withTimeout(2_000) { expired.await() }
        assertEquals(3, server.requestCount)
    }

    @Test
    fun `a transient refresh failure keeps the session and surfaces the 401`() = runBlocking {
        tokens.value = "old-jwt"
        val expired = async(start = CoroutineStart.UNDISPATCHED) {
            withTimeoutOrNull(300) { api.sessionExpired.first() }
        }
        enqueueJson("{}", code = 401)
        enqueueJson("{}", code = 503)

        try {
            api.me()
            fail("expected PartnerException.Http")
        } catch (e: PartnerException.Http) {
            assertEquals(401, e.status)
        }

        assertNull("no session-expired signal on a 5xx refresh", expired.await())
        assertEquals("old-jwt", tokens.value)
        assertEquals(2, server.requestCount)
    }

    @Test
    fun `the login endpoints never refresh on a 401`() = runBlocking {
        tokens.value = "stale-jwt" // left over from an earlier session
        enqueueJson("""{"message":"Invalid credentials"}""", code = 401)

        try {
            api.login("weaver@example.com", "wrong")
            fail("expected PartnerException.Http")
        } catch (e: PartnerException.Http) {
            assertEquals(401, e.status)
        }
        enqueueJson("""{"message":"Wrong PIN"}""", code = 401)
        try {
            api.loginWithPhone("+919876543210", "111222")
            fail("expected PartnerException.Http")
        } catch (e: PartnerException.Http) {
            assertEquals(401, e.status)
        }

        assertEquals(2, server.requestCount)
        assertEquals("/auth/partner/emailpass", server.takeRequest().path)
        assertEquals("/auth/partner/phone-pin", server.takeRequest().path)
    }

    @Test
    fun `an unauthenticated 401 does not try to refresh`() = runBlocking {
        enqueueJson("""{"message":"Unauthorized"}""", code = 401)

        try {
            api.me()
            fail("expected PartnerException.Http")
        } catch (e: PartnerException.Http) {
            assertEquals(401, e.status)
        }
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `concurrent 401s share a single refresh`() = runBlocking {
        tokens.value = "old-jwt"
        val refreshes = AtomicInteger(0)
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val auth = request.getHeader("Authorization")
                return when {
                    request.path == "/partners/auth/refresh" -> {
                        refreshes.incrementAndGet()
                        Thread.sleep(150) // hold the mutex while the others pile up
                        MockResponse().setBody("""{"token":"new-jwt"}""")
                    }
                    auth == "Bearer new-jwt" -> MockResponse().setBody(meBody)
                    else -> MockResponse().setResponseCode(401).setBody("{}")
                }
            }
        }

        val results = (1..5).map { async(Dispatchers.IO) { api.me() } }.awaitAll()

        assertEquals(5, results.size)
        assertEquals(1, refreshes.get())
        assertEquals("new-jwt", tokens.value)
    }
}

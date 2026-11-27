package com.jyt.partner

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jyt.partner.api.PartnerApi
import com.jyt.partner.push.PushManager
import com.jyt.partner.models.PartnerException
import com.jyt.partner.models.PartnerMe
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Holds the partner session — the AuthStore counterpart: restores on cold
 * start from the stored token by asking /partners/me, exposes login/logout.
 *
 * A restore failure is NOT always "the token is stale": the backend being
 * unreachable (offline, flaky data) must not wipe the session — only a
 * 401 does. Anything else parks in [State.RestoreFailed] with the token
 * kept, so a Retry re-runs the restore instead of forcing a sign-in.
 *
 * Keep-alive: the restore refreshes the token before /partners/me, the app
 * refreshes again on returning to the foreground once the token is 6 h old,
 * and any call whose 401 the refresh can't fix ends the session here
 * (PartnerApi.sessionExpired) with a "session expired" note on Login.
 */
class AuthViewModel : ViewModel() {

    sealed interface State {
        data object Restoring : State
        data object SignedOut : State
        data object RestoreFailed : State
        data class SignedIn(val me: PartnerMe) : State
    }

    private val _state = MutableStateFlow<State>(State.Restoring)
    val state: StateFlow<State> = _state

    /** The last error a login attempt produced — surfaced by the login form. */
    val loginError = MutableStateFlow<String?>(null)

    /** A sign-in request is in flight — the form shows a spinner and
     *  ignores further taps so a slow network can't fire it twice. */
    val signingIn = MutableStateFlow(false)

    init {
        viewModelScope.launch {
            PartnerApi.get(appContext).sessionExpired.collect { endExpiredSession() }
        }
        viewModelScope.launch { restore() }
    }

    private suspend fun restore() {
        val api = PartnerApi.get(appContext)
        if (TokenStore.loadToken(appContext) == null) {
            _state.value = State.SignedOut
            return
        }
        // Refresh first: a stored token is often past its one-day life. A
        // refusal ends the session; a network/5xx failure keeps the old token
        // and carries on to /me exactly as before.
        if (api.refreshToken() == PartnerApi.RefreshOutcome.REJECTED) {
            endExpiredSession()
            return
        }
        try {
            _state.value = State.SignedIn(api.me())
        } catch (e: PartnerException.SessionExpired) {
            endExpiredSession()
        } catch (e: PartnerException.Http) {
            if (e.status == 401) {
                // A stored token /partners/me no longer accepts is as good as none.
                TokenStore.clearToken(appContext)
                _state.value = State.SignedOut
            } else {
                _state.value = State.RestoreFailed
            }
        } catch (e: Exception) {
            // Network down / server unreachable — keep the token, let the
            // user retry rather than silently wiping the session.
            _state.value = State.RestoreFailed
        }
    }

    /** The app came to the foreground — refresh the token if it is 6 h old.
     *  Only a refusal signs out; a failed attempt waits for the next one. */
    fun onForeground() {
        if (_state.value !is State.SignedIn) return
        val api = PartnerApi.get(appContext)
        if (!api.refreshDue()) return
        viewModelScope.launch {
            if (api.refreshToken() == PartnerApi.RefreshOutcome.REJECTED) {
                endExpiredSession()
            }
        }
    }

    /** The server won't renew the session: drop the token and land on Login
     *  with a note saying why. Idempotent — several failing calls may report it. */
    private fun endExpiredSession() {
        if (_state.value == State.SignedOut) return
        TokenStore.clearToken(appContext)
        loginError.value = SESSION_EXPIRED_MESSAGE
        _state.value = State.SignedOut
    }

    /** Re-runs the session restore after a transient failure. */
    fun retryRestore() {
        _state.value = State.Restoring
        viewModelScope.launch { restore() }
    }

    fun login(context: Context, email: String, password: String) {
        if (signingIn.value) return
        signingIn.value = true
        viewModelScope.launch {
            loginError.value = null
            val api = PartnerApi.get(context)
            try {
                val outcome = api.login(email.trim(), password)
                if (outcome.verificationRequired) {
                    loginError.value =
                        "Your email isn't verified yet. Check your inbox for the verification code, then sign in again."
                    return@launch
                }
                _state.value = State.SignedIn(api.me())
            } catch (e: Exception) {
                loginError.value = e.message ?: "Sign in failed."
            } finally {
                signingIn.value = false
            }
        }
    }

    /** Phone number + PIN (#2320). */
    fun loginWithPhone(context: Context, phone: String, pin: String) {
        if (signingIn.value) return
        signingIn.value = true
        viewModelScope.launch {
            loginError.value = null
            val api = PartnerApi.get(context)
            try {
                api.loginWithPhone(phone.trim(), pin)
                _state.value = State.SignedIn(api.me())
            } catch (e: PartnerException.Http) {
                loginError.value = when {
                    e.status != 401 -> e.message ?: "Sign in failed."
                    e.serverMessage.contains("Too many wrong PINs") ->
                        "Too many wrong PINs. Wait 15 minutes, or sign in with your email."
                    else -> "Wrong phone number or PIN."
                }
            } catch (e: Exception) {
                loginError.value = e.message ?: "Sign in failed."
            } finally {
                signingIn.value = false
            }
        }
    }

    fun logout(context: Context) {
        // The screen leaves at once; the session is cleared only AFTER the
        // device is unregistered. Clearing it first sent the DELETE with no
        // token — a 401 — so a signed-out phone kept getting this partner's
        // pushes (seen in prod logs, 2026-11-27). Capped so a dead network
        // can't hold sign-out open.
        _state.value = State.SignedOut
        val app = context.applicationContext
        val signedOutToken = TokenStore.loadToken(app)
        viewModelScope.launch {
            withTimeoutOrNull(UNREGISTER_TIMEOUT_MS) { PushManager.unregisterCurrentDevice(app) }
            // Signed straight back in meanwhile? Then the stored token is the
            // NEW session's — leave it.
            if (TokenStore.loadToken(app) == signedOutToken) PartnerApi.get(app).logout()
        }
    }

    private companion object {
        const val SESSION_EXPIRED_MESSAGE = "Your session expired, please sign in again."
        const val UNREGISTER_TIMEOUT_MS = 5_000L
    }

    private val appContext: Context
        get() = JytPartnerApp.instance ?: throw IllegalStateException(
            "Application context unavailable"
        )
}

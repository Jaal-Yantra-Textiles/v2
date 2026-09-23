package com.jyt.partner

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jyt.partner.api.PartnerApi
import com.jyt.partner.push.PushManager
import com.jyt.partner.models.PartnerMe
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * Holds the partner session — the AuthStore counterpart: restores on cold
 * start from the stored token by asking /partners/me, exposes login/logout.
 */
class AuthViewModel : ViewModel() {

    sealed interface State {
        data object Restoring : State
        data object SignedOut : State
        data class SignedIn(val me: PartnerMe) : State
    }

    private val _state = MutableStateFlow<State>(State.Restoring)
    val state: StateFlow<State> = _state

    /** The last error a login attempt produced — surfaced by the login form. */
    val loginError = MutableStateFlow<String?>(null)

    init {
        viewModelScope.launch { restore() }
    }

    private suspend fun restore() {
        val api = PartnerApi.get(appContext)
        if (TokenStore.loadToken(appContext) == null) {
            _state.value = State.SignedOut
            return
        }
        try {
            _state.value = State.SignedIn(api.me())
        } catch (e: Exception) {
            // A stored token /partners/me no longer accepts is as good as none.
            TokenStore.clearToken(appContext)
            _state.value = State.SignedOut
        }
    }

    fun login(context: Context, email: String, password: String) {
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
            }
        }
    }

    fun logout(context: Context) {
        // Sign-out also unregisters the device so a signed-out phone stops
        // receiving this partner's pushes.
        PushManager.unregisterCurrentDevice(context)
        PartnerApi.get(context).logout()
        _state.value = State.SignedOut
    }

    private val appContext: Context
        get() = JytPartnerApp.instance ?: throw IllegalStateException(
            "Application context unavailable"
        )
}

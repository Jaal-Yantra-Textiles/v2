package com.jyt.partner

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * The JWT store — the Keychain's counterpart on Android. Encrypted
 * SharedPreferences under a hardware-backed master key; a token /partners/me
 * no longer accepts is cleared by the auth flow exactly like iOS.
 */
object TokenStore {
    private const val FILE = "jyt_partner_session"
    private const val KEY_TOKEN = "jwt"
    private const val KEY_LAST_PUSH_TOKEN = "lastPushToken"

    @Volatile
    private var prefs: android.content.SharedPreferences? = null

    private fun prefs(context: Context): android.content.SharedPreferences {
        return prefs ?: synchronized(this) {
            prefs ?: EncryptedSharedPreferences.create(
                context,
                FILE,
                MasterKey.Builder(context)
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .build(),
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            ).also { prefs = it }
        }
    }

    fun loadToken(context: Context): String? =
        prefs(context).getString(KEY_TOKEN, null)?.takeIf { it.isNotBlank() }

    fun saveToken(context: Context, token: String) {
        prefs(context).edit().putString(KEY_TOKEN, token).apply()
    }

    fun clearToken(context: Context) {
        prefs(context).edit().remove(KEY_TOKEN).apply()
    }

    // The last FCM token we registered — sign-out unregisters it so a
    // signed-out device stops receiving this partner's pushes.
    fun lastPushToken(context: Context): String? =
        prefs(context).getString(KEY_LAST_PUSH_TOKEN, null)

    fun savePushToken(context: Context, token: String) {
        prefs(context).edit().putString(KEY_LAST_PUSH_TOKEN, token).apply()
    }
}

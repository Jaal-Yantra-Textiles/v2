package com.jyt.partner

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * The JWT store — the Keychain's counterpart on Android. Encrypted
 * SharedPreferences under a hardware-backed master key. JWTs live one day;
 * PartnerApi refreshes them (POST /partners/auth/refresh) and records when,
 * so a partner stays signed in. A token the refresh route refuses is cleared.
 */
object TokenStore {
    private const val FILE = "jyt_partner_session"
    private const val KEY_TOKEN = "jwt"
    private const val KEY_LAST_PUSH_TOKEN = "lastPushToken"
    private const val KEY_LAST_REFRESH = "lastRefreshAt"

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
        prefs(context).edit().remove(KEY_TOKEN).remove(KEY_LAST_REFRESH).apply()
    }

    // When the JWT was last issued (sign-in) or refreshed, epoch millis —
    // the foreground check refreshes once this is more than 6 h old.
    fun lastRefreshAt(context: Context): Long? =
        prefs(context).getLong(KEY_LAST_REFRESH, 0L).takeIf { it > 0L }

    fun saveLastRefreshAt(context: Context, epochMillis: Long) {
        prefs(context).edit().putLong(KEY_LAST_REFRESH, epochMillis).apply()
    }

    // The last FCM token we registered — sign-out unregisters it so a
    // signed-out device stops receiving this partner's pushes.
    fun lastPushToken(context: Context): String? =
        prefs(context).getString(KEY_LAST_PUSH_TOKEN, null)

    fun savePushToken(context: Context, token: String) {
        prefs(context).edit().putString(KEY_LAST_PUSH_TOKEN, token).apply()
    }
}

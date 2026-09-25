package com.jyt.partner.push

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import com.google.android.gms.tasks.Tasks
import com.google.firebase.messaging.FirebaseMessaging
import com.jyt.partner.JytPartnerApp
import com.jyt.partner.TokenStore
import com.jyt.partner.api.PartnerApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * The push leg of the partner notification system, client side — the
 * PushManager counterpart. Asks for the notification permission, fetches
 * the FCM token and posts it to /partners/device-tokens (which upserts, so
 * token rotation never leaves a stale row).
 *
 * A registration failure is logged and retried on the next sign-in —
 * missing a push must never break the app itself. Without a
 * google-services.json the whole path is a guarded no-op.
 */
object PushManager {
    private const val TAG = "PushManager"
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** The run id a push wants opened — the nav host observes and opens it. */
    private val _pendingRunId = MutableStateFlow<String?>(null)
    val pendingRunId: StateFlow<String?> = _pendingRunId

    @Volatile
    private var requestedAuthorization = false

    fun offerPendingRunId(runId: String?) {
        _pendingRunId.value = runId
    }

    /** Called on sign-in (and session restore): permission, then FCM token. */
    fun enableAfterSignIn(context: Context) {
        if (!JytPartnerApp.pushConfigured) return
        if (!hasNotificationPermission(context)) {
            // The permission itself is requested from the UI layer (activity)
            // so the system dialog has a foreground context; when granted,
            // registerToken is triggered from the same place.
            return
        }
        registerToken(context)
    }

    fun onNotificationPermissionGranted(context: Context) {
        requestedAuthorization = true
        registerToken(context)
    }

    private fun hasNotificationPermission(context: Context): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(
                context, Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED

    private fun registerToken(context: Context) {
        if (!JytPartnerApp.pushConfigured) return
        if (requestedAuthorization && !hasNotificationPermission(context)) return
        requestedAuthorization = true

        scope.launch {
            try {
                val token = Tasks.await(FirebaseMessaging.getInstance().token)
                PartnerApi.get(context).registerDeviceToken(
                    token = token,
                    appVersion = context.packageManager
                        .getPackageInfo(context.packageName, 0).versionName,
                )
                TokenStore.savePushToken(context, token)
            } catch (e: Exception) {
                Log.w(TAG, "token registration failed: ${e.message}")
            }
        }
    }

    /** Sign-out unregisters the last known token so a signed-out device
     *  stops receiving this partner's pushes. */
    fun unregisterCurrentDevice(context: Context) {
        if (!JytPartnerApp.pushConfigured) return
        val token = TokenStore.lastPushToken(context) ?: return
        scope.launch {
            try {
                PartnerApi.get(context).unregisterDeviceToken(token)
            } catch (e: Exception) {
                Log.w(TAG, "token unregistration failed: ${e.message}")
            }
        }
    }
}

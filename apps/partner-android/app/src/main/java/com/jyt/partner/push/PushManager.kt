package com.jyt.partner.push

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.tasks.Tasks
import com.google.firebase.messaging.FirebaseMessaging
import com.jyt.partner.JytPartnerApp
import com.jyt.partner.MainActivity
import com.jyt.partner.R
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

    /** Where a tapped push wants to go — the nav host observes and opens it. */
    sealed interface Target {
        data class Run(val id: String) : Target
        data class InventoryOrder(val id: String) : Target
    }

    private val _pendingTarget = MutableStateFlow<Target?>(null)
    val pendingTarget: StateFlow<Target?> = _pendingTarget

    @Volatile
    private var requestedAuthorization = false

    fun offerTarget(target: Target?) {
        _pendingTarget.value = target
    }

    /**
     * The target named by a push's data map. The keys are the ones the
     * backend stamps (partner-push-on-send, run reminders); a background
     * push delivers the same keys as the launch intent's extras.
     */
    fun targetFrom(get: (String) -> String?): Target? {
        get("inventory_order_id")?.takeIf { it.isNotBlank() }?.let { return Target.InventoryOrder(it) }
        get("production_run_id")?.takeIf { it.isNotBlank() }?.let { return Target.Run(it) }
        return null
    }

    /** One channel for work arriving: new designs, orders and reminders.
     *  Also FCM's default channel (manifest), so background pushes land here. */
    fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_WORK, "New work", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "New designs, inventory orders and reminders"
            }
        )
    }

    /**
     * A push that arrives while the app is open: Android shows nothing on
     * its own, so post it ourselves. Tapping opens the app on its target —
     * it never navigates by itself (that used to yank the partner off
     * whatever screen they were on).
     */
    fun show(context: Context, title: String, body: String?, data: Map<String, String>) {
        if (!hasNotificationPermission(context)) return
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            data.forEach { (k, v) -> putExtra(k, v) }
        }
        val key = data["inventory_order_id"] ?: data["production_run_id"] ?: title
        val pending = PendingIntent.getActivity(
            context,
            key.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_WORK)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(key.hashCode(), notification)
        } catch (e: SecurityException) {
            Log.w(TAG, "notification not shown: ${e.message}")
        }
    }

    const val CHANNEL_WORK = "work"

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

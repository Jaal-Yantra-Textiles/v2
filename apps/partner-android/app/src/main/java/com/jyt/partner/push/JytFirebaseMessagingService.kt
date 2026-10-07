package com.jyt.partner.push

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.jyt.partner.TokenStore
import com.jyt.partner.api.PartnerApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * FCM entry point — the APNs delegate's counterpart. Token rotations post
 * to /partners/device-tokens; a message carrying `production_run_id` or
 * `inventory_order_id` in its data opens that screen when tapped.
 *
 * Never fires while google-services.json is absent — see JytPartnerApp.
 */
class JytFirebaseMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        scope.launch {
            try {
                PartnerApi.get(applicationContext).registerDeviceToken(
                    token = token,
                    appVersion = packageManager.getPackageInfo(packageName, 0).versionName,
                )
                TokenStore.savePushToken(applicationContext, token)
            } catch (e: Exception) {
                Log.w(TAG, "token registration failed: ${e.message}")
            }
        }
    }

    /** Runs while the app is open (and for data-only pushes): post it so the
     *  partner sees it; the tap opens the run or order. In the background
     *  FCM posts the `notification` block itself on the "work" channel. */
    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        val title = message.notification?.title ?: message.data["title"] ?: return
        val body = message.notification?.body ?: message.data["description"]
        PushManager.show(applicationContext, title, body, message.data)
    }

    companion object {
        private const val TAG = "JytFCM"
        private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    }
}

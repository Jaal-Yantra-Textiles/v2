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
 * to /partners/device-tokens; a message carrying `production_run_id` in
 * its data (what the backend's notification-push provider stamps on run
 * reminders) becomes a deep-link hand-off through PushManager.
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

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        val runId = message.data["production_run_id"]
        if (runId != null) {
            PushManager.offerPendingRunId(runId)
        }
    }

    companion object {
        private const val TAG = "JytFCM"
        private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    }
}

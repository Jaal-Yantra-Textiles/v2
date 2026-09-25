package com.jyt.partner

import android.app.Application
import android.util.Log
import com.google.firebase.FirebaseApp

/**
 * The push leg of the partner notification system, client side — guarded
 * Firebase init. Without a google-services.json in the tree (deliberate:
 * the build must not require it), FirebaseApp.initializeApp returns null
 * and push stays a no-op; the moment one is dropped in, the
 * JytFirebaseMessagingService starts receiving tokens and reminders.
 */
class JytPartnerApp : Application() {
    override fun onCreate() {
        super.onCreate()
        instance = this
        val firebase = try {
            FirebaseApp.initializeApp(this)
        } catch (e: Exception) {
            Log.w(TAG, "Firebase unavailable — push disabled: ${e.message}")
            null
        }
        pushConfigured = firebase != null
        if (firebase == null) {
            Log.i(TAG, "Push disabled — no Firebase configuration (google-services.json absent)")
        }
    }

    companion object {
        private const val TAG = "JYTPartnerApp"

        @Volatile
        var pushConfigured: Boolean = false
            private set

        @Volatile
        var instance: JytPartnerApp? = null
            private set
    }
}

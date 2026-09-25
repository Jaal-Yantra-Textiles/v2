package com.jyt.partner

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import com.jyt.partner.push.PushManager
import com.jyt.partner.ui.JytPartnerNavHost
import com.jyt.partner.ui.theme.JytPartnerTheme

class MainActivity : ComponentActivity() {

    private val auth: AuthViewModel by viewModels()

    private val notificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) {
                PushManager.onNotificationPermissionGranted(applicationContext)
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        // The system splash stays up while the stored session restores, so
        // a cold start never flashes the login form first. A restore that
        // fails on the network dismisses the splash into the retry gate.
        splash.setKeepOnScreenCondition {
            auth.state.value is AuthViewModel.State.Restoring
        }
        setContent {
            JytPartnerTheme {
                val state by auth.state.collectAsState()
                val signedIn = state is AuthViewModel.State.SignedIn
                // Fires once per sign-in (restore or fresh login) — the
                // boolean key doesn't change with every SignedIn instance,
                // so the permission is never re-asked spuriously. Once
                // granted (API 33+), the push token registers.
                LaunchedEffect(signedIn) {
                    if (signedIn) {
                        requestPushPermissionIfNeeded()
                        PushManager.enableAfterSignIn(applicationContext)
                    }
                }
                JytPartnerNavHost(auth = auth)
            }
        }
    }

    private fun requestPushPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}

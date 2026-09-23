package com.jyt.partner

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.lifecycle.viewmodel.compose.viewModel
import com.jyt.partner.push.PushManager
import com.jyt.partner.ui.JytPartnerNavHost
import com.jyt.partner.ui.theme.JytPartnerTheme

class MainActivity : ComponentActivity() {

    private val notificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) {
                PushManager.onNotificationPermissionGranted(applicationContext)
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            JytPartnerTheme {
                val auth: AuthViewModel = viewModel()
                // Session restore completes → ask for the notification
                // permission once (API 33+), then the push token registers.
                androidx.compose.runtime.LaunchedEffect(auth.state) {
                    val state = auth.state
                    if (state is AuthViewModel.State.SignedIn) {
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

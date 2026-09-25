package com.jyt.partner.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Checkroom
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.outlined.Checkroom
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.jyt.partner.AuthViewModel
import com.jyt.partner.R
import com.jyt.partner.push.PushManager

/** Top-level routes — login vs the tabbed partner area, plus detail pushes. */
object Routes {
    const val LOGIN = "login"
    const val MAIN = "main"
    const val ORDER = "order/{orderId}"
    const val RUN = "run/{runId}"
    const val DESIGN = "design/{designId}"
    const val INVENTORY_ORDER = "inventory/{orderId}"
    const val INCOMING = "incoming"
    const val INCOMING_ORDER = "incoming/{orderId}"

    fun order(id: String) = "order/$id"
    fun run(id: String) = "run/$id"
    fun design(id: String) = "design/$id"
    fun inventoryOrder(id: String) = "inventory/$id"
    fun incomingOrder(id: String) = "incoming/$id"
}

@Composable
fun JytPartnerNavHost(auth: AuthViewModel) {
    val state by auth.state.collectAsState()

    when (state) {
        // Session restore in flight — the system splash normally covers
        // this; the gate is the fallback (and holds the retry button).
        AuthViewModel.State.Restoring -> RestoringGate(onRetry = null)
        AuthViewModel.State.RestoreFailed -> RestoringGate(onRetry = { auth.retryRestore() })
        else -> {
            // A fresh NavHost per session class change (signed-in vs not)
            // so startDestination is only ever computed once the session is
            // RESOLVED — never mid-restore, so a cold start with a stored
            // token can't strand the user on the login screen.
            val startSignedIn = state is AuthViewModel.State.SignedIn
            key(startSignedIn) {
                val navController = rememberNavController()
                val pendingRunId by PushManager.pendingRunId.collectAsState()
                LaunchedEffect(pendingRunId, state) {
                    val runId = pendingRunId ?: return@LaunchedEffect
                    if (state is AuthViewModel.State.SignedIn) {
                        PushManager.offerPendingRunId(null)
                        navController.navigate(Routes.run(runId))
                    }
                }

                NavHost(
                    navController = navController,
                    startDestination = if (startSignedIn) Routes.MAIN else Routes.LOGIN,
                ) {
                    composable(Routes.LOGIN) {
                        LoginScreen(auth = auth)
                    }
                    composable(Routes.MAIN) {
                        MainScaffold(auth = auth, navController = navController)
                    }
                    composable(Routes.ORDER) { entry ->
                        val orderId = entry.arguments?.getString("orderId").orEmpty()
                        OrderDetailScreen(
                            auth = auth,
                            orderId = orderId,
                            onOpenRun = { runId -> navController.navigate(Routes.run(runId)) },
                            onOpenDesign = { designId -> navController.navigate(Routes.design(designId)) },
                            onBack = { navController.popBackStack() },
                        )
                    }
                    composable(Routes.RUN) { entry ->
                        val runId = entry.arguments?.getString("runId").orEmpty()
                        RunDetailScreen(
                            runId = runId,
                            onOpenDesign = { designId -> navController.navigate(Routes.design(designId)) },
                            onBack = { navController.popBackStack() },
                        )
                    }
                    composable(Routes.DESIGN) { entry ->
                        val designId = entry.arguments?.getString("designId").orEmpty()
                        DesignDetailScreen(
                            designId = designId,
                            onOpenRun = { runId -> navController.navigate(Routes.run(runId)) },
                            onBack = { navController.popBackStack() },
                        )
                    }
                    composable(Routes.INVENTORY_ORDER) { entry ->
                        val orderId = entry.arguments?.getString("orderId").orEmpty()
                        InventoryOrderDetailScreen(
                            orderId = orderId,
                            onBack = { navController.popBackStack() },
                        )
                    }
                    composable(Routes.INCOMING) {
                        IncomingDeliveriesScreen(
                            onBack = { navController.popBackStack() },
                            onOpenDelivery = { id ->
                                navController.navigate(Routes.incomingOrder(id))
                            },
                        )
                    }
                    composable(Routes.INCOMING_ORDER) { entry ->
                        val orderId = entry.arguments?.getString("orderId").orEmpty()
                        IncomingDeliveryDetailScreen(
                            deliveryId = orderId,
                            onBack = { navController.popBackStack() },
                        )
                    }
                }
            }
        }
    }
}

/** The brand gate shown while (or after) the session restores — the same
 *  navy + saffron mark the system splash uses. With [onRetry] non-null it
 *  doubles as the "couldn't reach the server" state: the stored token is
 *  kept and Retry re-runs the restore instead of forcing a sign-in. */
@Composable
private fun RestoringGate(onRetry: (() -> Unit)?) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(LunaSky),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Surface(
            shape = RoundedCornerShape(24.dp),
            color = androidx.compose.ui.graphics.Color.Transparent,
            modifier = Modifier.size(120.dp),
        ) {
            Image(
                painter = painterResource(R.drawable.ic_launcher_foreground),
                contentDescription = null,
                modifier = Modifier.padding(4.dp),
            )
        }
        Spacer(Modifier.height(12.dp))
            Text(
                text = "Luna",
                fontSize = 30.sp,
                fontWeight = FontWeight.Bold,
                color = LunaSilver,
            )
        Spacer(Modifier.height(28.dp))
        if (onRetry == null) {
            CircularProgressIndicator(color = LunaSilver)
        } else {
            Text(
                text = "Couldn't reach the server. Your sign-in is kept — check your connection.",
                fontSize = 13.sp,
                color = LunaMuted,
                modifier = Modifier.padding(horizontal = 40.dp),
            )
            Spacer(Modifier.height(18.dp))
            Button(onClick = onRetry) { Text("Retry") }
        }
    }
}

// The Luna brand pair — charcoal night sky, silver moon.
private val LunaSky = androidx.compose.ui.graphics.Color(0xFF14161E)
private val LunaSilver = androidx.compose.ui.graphics.Color(0xFFEDEFF4)
private val LunaMuted = androidx.compose.ui.graphics.Color(0xFF9AA0AF)

private enum class Tab(val label: String, val filled: androidx.compose.ui.graphics.vector.ImageVector, val outlined: androidx.compose.ui.graphics.vector.ImageVector) {
    ORDERS("Orders", Icons.Filled.Checkroom, Icons.Outlined.Checkroom),
    INVENTORY("Inventory", Icons.Filled.Inventory2, Icons.Outlined.Inventory2),
    SETTINGS("Settings", Icons.Filled.Settings, Icons.Outlined.Settings),
}

@Composable
private fun MainScaffold(auth: AuthViewModel, navController: androidx.navigation.NavHostController) {
    var selectedTab by rememberSaveable { mutableStateOf(Tab.ORDERS) }

    Scaffold(
        bottomBar = {
            NavigationBar {
                Tab.entries.forEach { tab ->
                    NavigationBarItem(
                        selected = tab == selectedTab,
                        onClick = { selectedTab = tab },
                        icon = {
                            Icon(
                                imageVector = if (tab == selectedTab) tab.filled else tab.outlined,
                                contentDescription = tab.label,
                            )
                        },
                        label = { Text(tab.label) },
                    )
                }
            }
        },
    ) { padding ->
        androidx.compose.foundation.layout.Box(modifier = Modifier.padding(padding)) {
            when (selectedTab) {
                Tab.ORDERS -> OrdersScreen(
                    onOpenOrder = { id -> navController.navigate(Routes.order(id)) },
                )
                Tab.INVENTORY -> InventoryOrdersScreen(
                    onOpenOrder = { id -> navController.navigate(Routes.inventoryOrder(id)) },
                )
                Tab.SETTINGS -> SettingsScreen(
                    auth = auth,
                    onOpenIncoming = { navController.navigate(Routes.INCOMING) },
                )
            }
        }
    }
}
